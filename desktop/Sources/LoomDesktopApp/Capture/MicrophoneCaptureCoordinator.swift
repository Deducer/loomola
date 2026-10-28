import AVFoundation
import CoreAudio
import CoreMedia
import Foundation
import OSLog

private let microphoneCaptureLog = Logger(
    subsystem: "cloud.dissonance.loom.desktop",
    category: "microphone-capture"
)

/// Captures microphone audio. Audio-note recording uses AVAudioEngine's
/// PCM buffer path so the exact samples that drive the live meter are also
/// written to disk. Voice processing is intentionally opt-in because macOS
/// can route meeting playback through the voice-processing unit, which makes
/// Zoom/Meet sound muted or ducked.
final class MicrophoneCaptureCoordinator: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    var onLevel: ((Double) -> Void)?
    var onPCMBuffer: ((AVAudioPCMBuffer) -> Void)?

    /// Compositor hook. When set, every mic `CMSampleBuffer` is also
    /// forwarded here so the CompositeRecorder can mux mic audio into
    /// the composite MP4 alongside the existing AudioAssetWriter file.
    /// Called on the audio engine tap thread.
    var onSampleBuffer: ((CMSampleBuffer) -> Void)?

    private var engine: AVAudioEngine?
    private var captureSession: AVCaptureSession?
    private var writer: AudioAssetWriter?

    /// Health of the file this capture is writing, or nil when there
    /// is no file writer (composite flow / not recording).
    var writeHealth: AudioAssetWriter.WriteHealth? { writer?.writeHealth }
    private var formatDescription: CMAudioFormatDescription?
    private var nextSampleTime: AVAudioFramePosition = 0
    private let sampleQueue = DispatchQueue(label: "cloud.dissonance.loom.desktop.mic-samples")
    private let recoveryQueue = DispatchQueue(label: "cloud.dissonance.loom.desktop.mic-recovery")
    private var selectedDeviceID: String?
    private var selectedOutputURL: URL?
    private var selectedVoiceProcessingEnabled = false
    private var configurationObserver: NSObjectProtocol?
    private var watchdogTimer: DispatchSourceTimer?
    private var lastBufferUptime: TimeInterval = 0
    /// Restart/stop serialization; mutated only on `recoveryQueue`.
    private var gate = MicRestartGate()
    private var stopping: Bool { gate.stopping }
    /// When true, the engine tap continues firing but every buffer is
    /// discarded — no file write, no level meter, no compositor
    /// callback. Pause = no audio data captured during this interval;
    /// the resulting file naturally elides the gap. Toggle from the
    /// owning AudioNoteRecorder on user pause/resume.
    private var paused = false
    var isPaused: Bool {
        get { paused }
        set {
            gapLock.lock()
            let now = ProcessInfo.processInfo.systemUptime
            if newValue, !paused {
                pausedSince = now
            } else if !newValue, let since = pausedSince {
                pausedTotal += now - since
                pausedSince = nil
            }
            paused = newValue
            gapLock.unlock()
        }
    }
    /// Mid-note engine restarts (device change) leave a hole in the mic
    /// file; the tracker sizes the silence that keeps the mic track on
    /// the same timeline as the system track. Guarded by `gapLock`
    /// (opened on the recovery queue, closed on the tap thread).
    private var gapTracker = MicRestartGapTracker()
    /// Bumped for every engine a restart starts; its tap only counts while
    /// it is the tracker's active epoch. Recovery-queue owned.
    private var engineEpoch = 0
    private var pausedTotal: TimeInterval = 0
    private var pausedSince: TimeInterval?
    private let gapLock = NSLock()

    /// Paused time so far, including an in-progress pause. Caller holds `gapLock`.
    private func pausedTotalLocked(now: TimeInterval) -> TimeInterval {
        pausedTotal + (pausedSince.map { now - $0 } ?? 0)
    }

    /// Starts capturing mic audio, optionally with AEC. Two write modes:
    ///
    /// - When `outputURL` is non-nil, writes captured PCM to a
    ///   .m4a file via AudioAssetWriter (the audio-note flow uses
    ///   this; the resulting file is uploaded as the mic track).
    /// - When `outputURL` is nil, skips file write entirely. The
    ///   mic samples still flow through `onSampleBuffer` to whatever
    ///   downstream consumer wired the callback (the composite
    ///   recorder uses this — the audio gets muxed inline into the
    ///   composite MP4, no separate file needed).
    func start(
        deviceID: String?,
        outputURL: URL?,
        voiceProcessingEnabled: Bool = false
    ) throws {
        selectedDeviceID = deviceID
        selectedOutputURL = outputURL
        selectedVoiceProcessingEnabled = voiceProcessingEnabled
        recoveryQueue.sync {
            gate.reset()
            engineEpoch = 0
        }
        gapLock.lock()
        gapTracker = MicRestartGapTracker()
        // The recording's origin is the first "audio end": if the engine
        // never delivers a buffer before a restart, the gap still runs from
        // here — the system track has been recording since the start too.
        gapTracker.markBuffer(uptime: ProcessInfo.processInfo.systemUptime, pausedTotal: 0)
        pausedTotal = 0
        pausedSince = nil
        gapLock.unlock()
        try startEngine(
            deviceID: deviceID,
            outputURL: outputURL,
            voiceProcessingEnabled: voiceProcessingEnabled,
            createWriter: true,
            epoch: 0
        )
        startWatchdog()
    }

    private func startEngine(
        deviceID: String?,
        outputURL: URL?,
        voiceProcessingEnabled: Bool,
        createWriter: Bool,
        epoch: Int
    ) throws {
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode

        // Apply the chosen mic at the audio-unit level. Must happen
        // before voice processing is enabled so the AEC reference signal
        // pairs with the right input device.
        if let deviceID {
            try setInputDevice(on: inputNode, uniqueID: deviceID)
        }

        if voiceProcessingEnabled {
            // Acoustic echo cancellation. macOS auto-uses the current
            // system output as the reference signal — the audio coming out
            // of the user's speakers gets subtracted from the mic input.
            do {
                try inputNode.setVoiceProcessingEnabled(true)
            } catch {
                // If voice processing can't be enabled (rare — usually
                // means the input device doesn't support it), fall back to
                // plain capture and log. The recording is still produced;
                // just without AEC, so the user may hear participant echo.
                print("[mic] voice processing unavailable, falling back: \(error)")
            }
        }

        let format = inputNode.outputFormat(forBus: 0)

        // Optional file writer. nil URL = skip the AudioAssetWriter
        // construction entirely (composite recording flow). Only start()
        // creates one: a restart reuses the existing writer and must never
        // open a second file over a note that has already been finalized.
        if let outputURL, writer == nil, createWriter {
            let writer = try AudioAssetWriter(
                outputURL: outputURL,
                sampleRate: format.sampleRate,
                channelCount: Int(format.channelCount)
            )
            try writer.start()
            self.writer = writer
        }

        // Cache the CMAudioFormatDescription so we don't rebuild it
        // every tap callback.
        self.formatDescription = try makeFormatDescription(from: format)
        self.nextSampleTime = 0

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) {
            [weak self] buffer, time in
            guard let self else { return }
            self.handleTap(buffer: buffer, time: time, epoch: epoch)
        }

        try engine.start()
        self.engine = engine
        self.lastBufferUptime = ProcessInfo.processInfo.systemUptime
        installConfigurationObserver(for: engine)
    }

    func startWithTimeout(
        deviceID: String?,
        outputURL: URL?,
        voiceProcessingEnabled: Bool = false,
        timeoutNanoseconds: UInt64 = 8_000_000_000
    ) async throws {
        try await withCheckedThrowingContinuation { continuation in
            let resolver = MicrophoneStartResolver(continuation)
            let startTask = Task.detached(priority: .userInitiated) { [self] in
                do {
                    try start(
                        deviceID: deviceID,
                        outputURL: outputURL,
                        voiceProcessingEnabled: voiceProcessingEnabled
                    )
                    if !resolver.resolve(.success(())) {
                        _ = try? await stop()
                    }
                } catch {
                    _ = resolver.resolve(.failure(error))
                }
            }

            Task.detached { [self, startTask] in
                try? await Task.sleep(nanoseconds: timeoutNanoseconds)
                if resolver.resolve(.failure(MicrophoneCaptureCoordinatorError.startTimedOut)) {
                    startTask.cancel()
                    await startTask.value
                    _ = try? await stop()
                }
            }
        }
    }

    func stop() async throws -> URL? {
        if let captureSession {
            captureSession.stopRunning()
            self.captureSession = nil
            if let writer = self.writer {
                self.writer = nil
                return try await writer.finish()
            }
            return nil
        }

        // Tear down on the recovery queue, where restarts run, so a stop
        // and a restart can never interleave: either the restart already
        // finished (and its engine is torn down here) or it hasn't started
        // and the gate makes it a no-op. The engine can also be nil while
        // a failed restart is being retried — the file written so far is
        // still finalized.
        let (writerToFinish, hadEngine) = recoveryQueue.sync { () -> (AudioAssetWriter?, Bool) in
            gate.stop()
            watchdogTimer?.cancel()
            watchdogTimer = nil
            if let configurationObserver {
                NotificationCenter.default.removeObserver(configurationObserver)
                self.configurationObserver = nil
            }
            let hadEngine = engine != nil
            if let engine {
                engine.inputNode.removeTap(onBus: 0)
                engine.stop()
            }
            engine = nil
            formatDescription = nil
            nextSampleTime = 0
            let writer = self.writer
            self.writer = nil
            return (writer, hadEngine)
        }
        if !hadEngine, writerToFinish == nil {
            throw MicrophoneCaptureCoordinatorError.notRecording
        }
        // Audio-note flow: finalize and return the file. Composite flow
        // has no file — nil.
        return try await writerToFinish?.finish()
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        if paused { return }
        try? writer?.append(sampleBuffer)
        let level = connection.audioChannels
            .map { AudioLevelSampler.linearLevel(fromDecibels: $0.averagePowerLevel) }
            .max()
        if let level {
            onLevel?(level)
        }
    }

    private func startCaptureSession(deviceID: String?, outputURL: URL?) throws {
        guard let outputURL else { throw MicrophoneCaptureCoordinatorError.missingOutputURL }
        let captureSession = AVCaptureSession()
        let device = try Self.audioDevice(id: deviceID)
        let input = try AVCaptureDeviceInput(device: device)
        guard captureSession.canAddInput(input) else {
            throw MicrophoneCaptureCoordinatorError.cannotAddInput
        }
        captureSession.addInput(input)

        let output = AVCaptureAudioDataOutput()
        output.setSampleBufferDelegate(self, queue: sampleQueue)
        guard captureSession.canAddOutput(output) else {
            throw MicrophoneCaptureCoordinatorError.cannotAddOutput
        }
        captureSession.addOutput(output)

        let writer = try AudioAssetWriter(outputURL: outputURL)
        try writer.start()
        self.writer = writer
        self.captureSession = captureSession
        self.paused = false
        captureSession.startRunning()
    }

    private static func audioDevice(id: String?) throws -> AVCaptureDevice {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone, .external],
            mediaType: .audio,
            position: .unspecified
        ).devices
        if let id, let device = devices.first(where: { $0.uniqueID == id }) {
            return device
        }
        if let device = AVCaptureDevice.default(for: .audio) {
            return device
        }
        throw MicrophoneCaptureCoordinatorError.noMicrophone
    }

    private func handleTap(buffer: AVAudioPCMBuffer, time: AVAudioTime, epoch: Int) {
        guard let formatDescription else { return }
        // Drop incoming buffers while paused. We deliberately keep the
        // engine running so resume is instant and the input device
        // stays warm (re-acquiring a USB / Bluetooth mic on resume can
        // take 1-3 s and surfaces as a click in the recording).
        if paused { return }
        let arrival = ProcessInfo.processInfo.systemUptime
        lastBufferUptime = arrival

        // First buffer after a mid-note restart: fill the hole so the
        // mic file stays aligned with the system-audio file.
        gapLock.lock()
        // A late callback from the engine a restart just tore down: drop
        // it so it can't close the gap meant for the new engine.
        guard gapTracker.isCurrent(epoch: epoch) else {
            gapLock.unlock()
            return
        }
        let pausedNow = pausedTotalLocked(now: arrival)
        // Size gaps from the audio's own capture time (the buffer's host
        // time — the same mach clock as systemUptime), not from when this
        // callback happened to run: scheduling delay or a device-latency
        // change must not turn into silence in the file.
        let duration = Double(buffer.frameLength) / max(buffer.format.sampleRate, 1)
        let audioEnd = time.isHostTimeValid
            ? AVAudioTime.seconds(forHostTime: time.hostTime) + duration
            : arrival
        let silence = gapTracker.isOpen
            ? gapTracker.close(
                arrivalUptime: audioEnd,
                bufferDuration: duration,
                pausedTotal: pausedNow
            )
            : 0
        gapTracker.markBuffer(uptime: audioEnd, pausedTotal: pausedNow)
        gapLock.unlock()
        if silence > 0, let writer {
            let written = writer.appendSilence(seconds: silence)
            if written + 0.001 < silence {
                // Keep the unwritten remainder open for the next buffer and
                // drop this one: writing it now would shift the rest of the
                // note against the system-audio track. The failure is in
                // writeHealth, which drives the recorder's alert.
                gapLock.lock()
                gapTracker.reopenAfterPartialFill(written: written)
                gapLock.unlock()
                microphoneCaptureLog.error(
                    "mic gap fill wrote \(String(format: "%.2f", written), privacy: .public)s of \(String(format: "%.2f", silence), privacy: .public)s; retrying on the next buffer"
                )
                return
            }
            microphoneCaptureLog.notice(
                "filled \(String(format: "%.2f", silence), privacy: .public)s mic gap after engine restart"
            )
        }

        if let level = peakLevel(of: buffer) {
            onLevel?(level)
        }

        // File write: the AVAudioPCMBuffer from the engine tap goes
        // straight to AudioAssetWriter (which uses AVAudioFile and
        // wants PCM directly). No CMSampleBuffer round-trip needed
        // for this path.
        try? writer?.append(buffer)
        onPCMBuffer?(buffer)

        // Composite path: the bubble compositor still consumes
        // CMSampleBuffer, so build one for the callback.
        if onSampleBuffer != nil {
            let sampleTime = resolvedSampleTime(for: buffer, time: time)
            if let sampleBuffer = makeSampleBuffer(
                from: buffer,
                sampleTime: sampleTime,
                formatDescription: formatDescription
            ) {
                onSampleBuffer?(sampleBuffer)
            }
        }
    }

    private func installConfigurationObserver(for engine: AVAudioEngine) {
        if let configurationObserver {
            NotificationCenter.default.removeObserver(configurationObserver)
            self.configurationObserver = nil
        }
        configurationObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { [weak self] _ in
            self?.scheduleEngineRestart(reason: "configuration changed")
        }
    }

    private func startWatchdog() {
        watchdogTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: recoveryQueue)
        timer.schedule(deadline: .now() + 4, repeating: 2)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            guard !self.stopping, !self.paused, self.engine != nil else { return }
            let quietFor = ProcessInfo.processInfo.systemUptime - self.lastBufferUptime
            if quietFor > 6 {
                self.scheduleEngineRestart(reason: "no mic buffers for \(String(format: "%.1f", quietFor))s")
            }
        }
        timer.resume()
        watchdogTimer = timer
    }

    private func scheduleEngineRestart(reason: String) {
        recoveryQueue.async { [weak self] in
            guard let self else { return }
            guard let ticket = self.gate.begin() else { return }
            // File-backed audio notes used to suppress this restart, which
            // silenced the mic for the rest of the note after any input
            // change (AirPods connecting, Zoom grabbing the mic) — the
            // recorder then vanished from the transcript. The restart keeps
            // the same AudioAssetWriter (it resamples any input rate to
            // 48 kHz) and the gap tracker pads the hole with silence.
            self.recoveryQueue.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                self?.restartEngine(reason: reason, ticket: ticket)
            }
        }
    }

    /// Runs on `recoveryQueue`. `ticket` is the gate generation the
    /// attempt was scheduled in; a stop() since then makes it obsolete.
    private func restartEngine(reason: String, ticket: Int) {
        guard gate.isCurrent(ticket) else {
            gate.finishAttempt()
            return
        }
        microphoneCaptureLog.error("restarting microphone engine: \(reason, privacy: .public)")
        if let configurationObserver {
            NotificationCenter.default.removeObserver(configurationObserver)
            self.configurationObserver = nil
        }
        // Quiesce the old tap FIRST, then open the gap for the next engine:
        // anything the old tap still delivers is now from a stale epoch.
        if let engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        engine = nil
        formatDescription = nil
        nextSampleTime = 0
        engineEpoch += 1
        gapLock.lock()
        // The epoch must advance even without a file (composite flow);
        // the silence fill itself only runs when there is a writer.
        gapTracker.open(nextEpoch: engineEpoch)
        gapLock.unlock()

        do {
            var lastError: Error?
            var started = false
            for device in MicRestartDevicePolicy.devicesToTry(selected: selectedDeviceID) {
                do {
                    try startEngine(
                        deviceID: device,
                        outputURL: selectedOutputURL,
                        voiceProcessingEnabled: selectedVoiceProcessingEnabled,
                        createWriter: false,
                        epoch: engineEpoch
                    )
                    started = true
                    if device != selectedDeviceID {
                        microphoneCaptureLog.error("selected microphone unavailable; recording from the system default input")
                    }
                    break
                } catch {
                    lastError = error
                    // A half-built engine must not linger between attempts.
                    if let engine {
                        engine.inputNode.removeTap(onBus: 0)
                        engine.stop()
                    }
                    engine = nil
                }
            }
            if !started { throw lastError ?? MicrophoneCaptureCoordinatorError.noMicrophone }
            microphoneCaptureLog.notice("microphone engine restarted")
        } catch {
            microphoneCaptureLog.error("microphone engine restart failed: \(error.localizedDescription, privacy: .public)")
            // With no engine the watchdog stays quiet (it only watches a
            // running engine), so a failed restart would leave the mic dead
            // for the rest of the note. Keep trying while recording; the
            // gap tracker keeps the original gap start across attempts.
            gate.finishAttempt()
            recoveryQueue.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self, self.gate.isCurrent(ticket), self.engine == nil else { return }
                self.scheduleEngineRestart(reason: "retry after failed restart: \(reason)")
            }
            return
        }
        gate.finishAttempt()
    }

    private func resolvedSampleTime(
        for buffer: AVAudioPCMBuffer,
        time: AVAudioTime
    ) -> AVAudioFramePosition {
        let frameLength = AVAudioFramePosition(buffer.frameLength)
        if time.isSampleTimeValid {
            nextSampleTime = time.sampleTime + frameLength
            return time.sampleTime
        }
        let sampleTime = nextSampleTime
        nextSampleTime += frameLength
        return sampleTime
    }
}

private final class MicrophoneStartResolver: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?

    init(_ continuation: CheckedContinuation<Void, Error>) {
        self.continuation = continuation
    }

    func resolve(_ result: Result<Void, Error>) -> Bool {
        lock.lock()
        guard let continuation else {
            lock.unlock()
            return false
        }
        self.continuation = nil
        lock.unlock()

        switch result {
        case .success:
            continuation.resume()
        case .failure(let error):
            continuation.resume(throwing: error)
        }
        return true
    }
}

// MARK: - Device selection

private func setInputDevice(
    on inputNode: AVAudioInputNode,
    uniqueID: String
) throws {
    guard let audioUnit = inputNode.audioUnit else {
        throw MicrophoneCaptureCoordinatorError.audioUnitUnavailable
    }
    var deviceID = try resolveAudioDeviceID(uniqueID: uniqueID)
    let status = AudioUnitSetProperty(
        audioUnit,
        kAudioOutputUnitProperty_CurrentDevice,
        kAudioUnitScope_Global,
        0,
        &deviceID,
        UInt32(MemoryLayout<AudioDeviceID>.size)
    )
    if status != noErr {
        throw MicrophoneCaptureCoordinatorError.cannotSetDevice(status)
    }
}

private func resolveAudioDeviceID(uniqueID: String) throws -> AudioDeviceID {
    var propertyAddress = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var dataSize: UInt32 = 0
    var status = AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject),
        &propertyAddress,
        0,
        nil,
        &dataSize
    )
    if status != noErr {
        throw MicrophoneCaptureCoordinatorError.cannotEnumerateDevices(status)
    }
    let deviceCount = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
    var deviceIDs = [AudioDeviceID](repeating: 0, count: deviceCount)
    status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &propertyAddress,
        0,
        nil,
        &dataSize,
        &deviceIDs
    )
    if status != noErr {
        throw MicrophoneCaptureCoordinatorError.cannotEnumerateDevices(status)
    }

    for deviceID in deviceIDs {
        if let id = audioDeviceUID(deviceID), id == uniqueID {
            return deviceID
        }
    }
    throw MicrophoneCaptureCoordinatorError.deviceNotFound(uniqueID)
}

private func audioDeviceUID(_ deviceID: AudioDeviceID) -> String? {
    var propertyAddress = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var dataSize: UInt32 = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var unmanaged: Unmanaged<CFString>?
    let status = AudioObjectGetPropertyData(
        deviceID,
        &propertyAddress,
        0,
        nil,
        &dataSize,
        &unmanaged
    )
    if status != noErr { return nil }
    return unmanaged?.takeRetainedValue() as String?
}

// MARK: - Buffer conversion

private func makeFormatDescription(
    from format: AVAudioFormat
) throws -> CMAudioFormatDescription {
    var asbd = format.streamDescription.pointee
    var formatDescription: CMAudioFormatDescription?
    let status = CMAudioFormatDescriptionCreate(
        allocator: kCFAllocatorDefault,
        asbd: &asbd,
        layoutSize: 0,
        layout: nil,
        magicCookieSize: 0,
        magicCookie: nil,
        extensions: nil,
        formatDescriptionOut: &formatDescription
    )
    if status != noErr {
        throw MicrophoneCaptureCoordinatorError.cannotBuildFormat(status)
    }
    guard let formatDescription else {
        throw MicrophoneCaptureCoordinatorError.cannotBuildFormat(status)
    }
    return formatDescription
}

private func makeSampleBuffer(
    from buffer: AVAudioPCMBuffer,
    sampleTime: AVAudioFramePosition,
    formatDescription: CMAudioFormatDescription
) -> CMSampleBuffer? {
    let frameCount = CMItemCount(buffer.frameLength)
    if frameCount == 0 { return nil }

    let sampleRate = buffer.format.sampleRate
    let pts = CMTime(
        value: sampleTime,
        timescale: CMTimeScale(sampleRate)
    )
    var timing = CMSampleTimingInfo(
        duration: CMTime(value: 1, timescale: CMTimeScale(sampleRate)),
        presentationTimeStamp: pts,
        decodeTimeStamp: .invalid
    )

    var sampleBuffer: CMSampleBuffer?
    let status = CMSampleBufferCreate(
        allocator: kCFAllocatorDefault,
        dataBuffer: nil,
        dataReady: false,
        makeDataReadyCallback: nil,
        refcon: nil,
        formatDescription: formatDescription,
        sampleCount: frameCount,
        sampleTimingEntryCount: 1,
        sampleTimingArray: &timing,
        sampleSizeEntryCount: 0,
        sampleSizeArray: nil,
        sampleBufferOut: &sampleBuffer
    )
    guard status == noErr, let sb = sampleBuffer else { return nil }

    let setStatus = CMSampleBufferSetDataBufferFromAudioBufferList(
        sb,
        blockBufferAllocator: kCFAllocatorDefault,
        blockBufferMemoryAllocator: kCFAllocatorDefault,
        flags: 0,
        bufferList: buffer.audioBufferList
    )
    if setStatus != noErr { return nil }

    return sb
}

private func peakLevel(of buffer: AVAudioPCMBuffer) -> Double? {
    guard let channelData = buffer.floatChannelData else { return nil }
    let frameLength = Int(buffer.frameLength)
    let channelCount = Int(buffer.format.channelCount)
    if frameLength == 0 || channelCount == 0 { return nil }

    var peak: Float = 0
    for ch in 0..<channelCount {
        let samples = channelData[ch]
        for i in 0..<frameLength {
            let sample = abs(samples[i])
            if sample > peak { peak = sample }
        }
    }
    return Double(min(max(peak, 0), 1))
}

enum MicrophoneCaptureCoordinatorError: LocalizedError {
    case noMicrophone
    case cannotAddInput
    case cannotAddOutput
    case notRecording
    case startTimedOut
    case missingOutputURL
    case audioUnitUnavailable
    case cannotSetDevice(OSStatus)
    case cannotEnumerateDevices(OSStatus)
    case deviceNotFound(String)
    case cannotBuildFormat(OSStatus)

    var errorDescription: String? {
        switch self {
        case .noMicrophone:
            return "No microphone was available to record."
        case .cannotAddInput:
            return "The selected microphone could not be added to the capture session."
        case .cannotAddOutput:
            return "Microphone audio output could not be added to the capture session."
        case .notRecording:
            return "There is no active microphone recording to stop."
        case .startTimedOut:
            return "The microphone took too long to start. Check microphone permissions or try another input device."
        case .missingOutputURL:
            return "The microphone recording is missing a local file path."
        case .audioUnitUnavailable:
            return "The microphone audio unit was not available."
        case .cannotSetDevice(let status):
            return "Could not select the chosen microphone (OSStatus \(status))."
        case .cannotEnumerateDevices(let status):
            return "Could not enumerate audio devices (OSStatus \(status))."
        case .deviceNotFound(let id):
            return "The selected microphone (id \(id)) was not found."
        case .cannotBuildFormat(let status):
            return "Could not build the audio format description (OSStatus \(status))."
        }
    }
}
