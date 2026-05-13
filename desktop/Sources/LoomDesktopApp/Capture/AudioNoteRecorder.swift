import AVFoundation
import Foundation
import OSLog

private let audioNoteRecorderLog = Logger(
    subsystem: "cloud.dissonance.loom.desktop",
    category: "audio-note-recorder"
)

@MainActor
final class AudioNoteRecorder {
    var onAudioLevel: ((Double) -> Void)?
    var onLiveAudioBuffer: ((LiveTranscriptAudioSource, AVAudioPCMBuffer) -> Void)?

    private let backend: BackendClient
    private var microphoneCapture: MicrophoneCaptureCoordinator?
    private let systemAudioCapture: SystemAudioCaptureCoordinator?
    private let coreAudioTapCapture: CoreAudioTapCaptureCoordinator?
    private var systemAudioDeviceCapture: MicrophoneCaptureCoordinator?
    private var activeSystemAudioCaptureMode: SystemAudioCaptureMode?
    private var session: AudioRecordingSession?

    /// Pause/resume bookkeeping. `paused` mirrors the flag both capture
    /// coordinators carry; `pauseStartedAt` is the wall-clock timestamp
    /// of the most recent pause (nil when running). `pausedAccumulatedSeconds`
    /// is total time spent paused this session — subtracted from
    /// (now - session.startedAt) at upload time so durationSeconds
    /// matches the actual audio duration on disk.
    private(set) var paused = false
    private var pauseStartedAt: Date?
    private var pausedAccumulatedSeconds: TimeInterval = 0

    /// True when a session exists in any state (recording or
    /// post-stop-failure). Used by orphan-rescue to detect that there
    /// is local data still on disk that wasn't uploaded.
    var hasActiveSession: Bool { session != nil }

    /// Read-only view of the active session for orphan recovery.
    /// Returns nil after a successful stopAndUpload (the session is
    /// torn down) or before any start. Stays valid after a failed
    /// stopAndUpload — that's the whole point.
    var currentSessionSnapshot: AudioRecordingSessionSnapshot? {
        guard let session else { return nil }
        return AudioRecordingSessionSnapshot(
            directory: session.directory,
            tracks: session.tracks,
            title: session.title,
            startedAt: session.startedAt,
            backendRecordingId: session.backendRecordingId,
            backendSlug: session.backendSlug,
            meetingContext: session.meetingContext
        )
    }

    /// Forget the in-memory session pointer without trying to abort
    /// or clean up files on disk. Used after we've successfully
    /// copied the local files into the orphan store — the session
    /// is now persisted somewhere durable, the recorder doesn't
    /// need to keep referencing it. The /var/folders dir stays put;
    /// macOS will purge it eventually. The orphan store is the
    /// authoritative copy from now on.
    func detachSessionAfterOrphanSave() {
        session = nil
        microphoneCapture = nil
        systemAudioDeviceCapture = nil
        activeSystemAudioCaptureMode = nil
    }

    init(backend: BackendClient) {
        self.backend = backend
        if #available(macOS 14.0, *) {
            systemAudioCapture = SystemAudioCaptureCoordinator()
        } else {
            systemAudioCapture = nil
        }
        if #available(macOS 14.2, *) {
            coreAudioTapCapture = CoreAudioTapCaptureCoordinator()
        } else {
            coreAudioTapCapture = nil
        }
    }

    func start(
        title: String?,
        includeMic: Bool,
        includeSystemAudio: Bool,
        meetingContext: MeetingContext? = nil,
        microphoneDeviceID: String? = nil,
        systemAudioCaptureMode: SystemAudioCaptureMode = .coreAudioTap,
        systemAudioDeviceID: String? = nil
    ) async throws -> AudioRecordingSession {
        guard session == nil else {
            throw AudioNoteRecorderError.alreadyRecording
        }

        var tracks = Set<TrackKind>()
        if includeMic { tracks.insert(.mic) }
        if includeSystemAudio { tracks.insert(.systemAudio) }
        guard !tracks.isEmpty else {
            throw AudioNoteRecorderError.noTracksSelected
        }

        let audioLevelSink = onAudioLevel
        let liveAudioSink = onLiveAudioBuffer
        systemAudioCapture?.onLevel = { level in
            audioLevelSink?(level)
        }
        systemAudioCapture?.onPCMBuffer = { buffer in
            liveAudioSink?(.systemAudio, buffer)
        }
        coreAudioTapCapture?.onLevel = { level in
            audioLevelSink?(level)
        }
        coreAudioTapCapture?.onPCMBuffer = { buffer in
            liveAudioSink?(.systemAudio, buffer)
        }

        let directory = try Self.createSessionDirectory()
        var nextSession = AudioRecordingSession(
            directory: directory,
            title: title?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            tracks: tracks,
            meetingContext: meetingContext
        )
        let response = try await backend.startRecording(nextSession.startRequest)
        nextSession.backendRecordingId = response.recordingId
        nextSession.backendSlug = response.slug
        session = nextSession

        do {
            if tracks.contains(.mic) {
                guard let url = nextSession.localFileURL(for: .mic) else {
                    throw AudioNoteRecorderError.missingLocalFileURL
                }
                microphoneCapture = try await startMicrophoneCapture(
                    primaryURL: url,
                    deviceID: microphoneDeviceID,
                    audioLevelSink: audioLevelSink
                )
            }
            if tracks.contains(.systemAudio) {
                guard let url = nextSession.localFileURL(for: .systemAudio) else {
                    throw AudioNoteRecorderError.missingLocalFileURL
                }
                switch systemAudioCaptureMode {
                case .coreAudioTap:
                    guard #available(macOS 14.2, *), let coreAudioTapCapture else {
                        throw AudioNoteRecorderError.systemAudioUnavailable
                    }
                    try coreAudioTapCapture.start(outputURL: url)
                    activeSystemAudioCaptureMode = .coreAudioTap
                case .screenCaptureKit:
                    guard let systemAudioCapture else {
                        throw AudioNoteRecorderError.systemAudioUnavailable
                    }
                    try await systemAudioCapture.start(outputURL: url)
                    activeSystemAudioCaptureMode = .screenCaptureKit
                case .audioDevice:
                    guard let systemAudioDeviceID else {
                        throw AudioNoteRecorderError.systemAudioDeviceRequired
                    }
                    systemAudioDeviceCapture = try await startSystemAudioDeviceCapture(
                        primaryURL: url,
                        deviceID: systemAudioDeviceID,
                        audioLevelSink: audioLevelSink,
                        liveAudioSink: liveAudioSink
                    )
                    activeSystemAudioCaptureMode = .audioDevice
                }
            }
            return nextSession
        } catch {
            await cancel()
            throw error
        }
    }

    func pause() {
        guard session != nil, !paused else { return }
        paused = true
        pauseStartedAt = Date()
        microphoneCapture?.isPaused = true
        coreAudioTapCapture?.isPaused = true
        systemAudioCapture?.isPaused = true
        systemAudioDeviceCapture?.isPaused = true
    }

    func resume() {
        guard session != nil, paused, let pauseStartedAt else { return }
        pausedAccumulatedSeconds += Date().timeIntervalSince(pauseStartedAt)
        self.pauseStartedAt = nil
        paused = false
        microphoneCapture?.isPaused = false
        coreAudioTapCapture?.isPaused = false
        systemAudioCapture?.isPaused = false
        systemAudioDeviceCapture?.isPaused = false
    }

    func stopAndUpload() async throws -> CompleteRecordingResponse {
        guard let session else {
            throw AudioNoteRecorderError.notRecording
        }
        guard let recordingId = session.backendRecordingId else {
            throw AudioNoteRecorderError.missingBackendRecordingId
        }
        // If user hits "End & upload" while paused, fold the in-progress
        // pause into the accumulator before computing duration.
        if paused, let pauseStartedAt {
            pausedAccumulatedSeconds += Date().timeIntervalSince(pauseStartedAt)
            self.pauseStartedAt = nil
            paused = false
            microphoneCapture?.isPaused = false
            coreAudioTapCapture?.isPaused = false
            systemAudioCapture?.isPaused = false
            systemAudioDeviceCapture?.isPaused = false
        }

        var localFiles: [TrackKind: URL] = [:]
        if session.tracks.contains(.mic) {
            // The mic coordinator returns the actual completed local file.
            // In the AEC fallback case this may be either the voice-processed
            // attempt URL or the plain-capture URL.
            if let micURL = try await microphoneCapture?.stop() {
                localFiles[.mic] = micURL
            }
            microphoneCapture = nil
        }
        if session.tracks.contains(.systemAudio) {
            switch activeSystemAudioCaptureMode {
            case .audioDevice:
                if let systemAudioURL = try await systemAudioDeviceCapture?.stop() {
                    localFiles[.systemAudio] = systemAudioURL
                }
                systemAudioDeviceCapture = nil
            case .screenCaptureKit:
                if let systemAudioCapture {
                    localFiles[.systemAudio] = try await systemAudioCapture.stop()
                }
            case .coreAudioTap:
                if #available(macOS 14.2, *), let coreAudioTapCapture {
                    localFiles[.systemAudio] = try await coreAudioTapCapture.stop()
                }
            case nil:
                audioNoteRecorderLog.error("system audio selected but no active capture mode was recorded")
            }
            activeSystemAudioCaptureMode = nil
        }

        for track in [TrackKind.mic, .systemAudio] {
            guard let url = localFiles[track] else {
                if session.tracks.contains(track) {
                    audioNoteRecorderLog.error("missing selected local track: \(track.rawValue, privacy: .public)")
                }
                continue
            }
            let bytes = Self.fileSize(url)
            audioNoteRecorderLog.notice("local track ready: \(track.rawValue, privacy: .public) bytes=\(bytes, privacy: .public) path=\(url.path, privacy: .public)")
            if bytes < Self.minimumUsableTrackBytes {
                if track == .mic {
                    throw AudioNoteRecorderError.emptyMicrophoneTrack(bytes)
                }
                throw AudioNoteRecorderError.emptySystemAudioTrack(bytes)
            }
        }

        let uploader = MultipartUploadCoordinator(backend: backend)
        var completedTracks: [TrackKind: [CompletedPart]] = [:]
        for track in [TrackKind.mic, .systemAudio] {
            guard let fileURL = localFiles[track] else { continue }
            let parts = try await uploader.uploadFile(
                url: fileURL,
                recordingId: recordingId,
                track: track
            )
            if !parts.isEmpty {
                completedTracks[track] = parts
            }
        }
        guard !completedTracks.isEmpty else {
            throw AudioNoteRecorderError.noCompletedAudioTracks
        }

        let elapsed = Date().timeIntervalSince(session.startedAt)
        let recordedSeconds = max(elapsed - pausedAccumulatedSeconds, 1)
        let response = try await backend.complete(
            recordingId: recordingId,
            request: CompleteRecordingRequest(
                tracks: completedTracks,
                durationSeconds: recordedSeconds
            )
        )
        try? FileManager.default.removeItem(at: session.directory)
        self.session = nil
        activeSystemAudioCaptureMode = nil
        pausedAccumulatedSeconds = 0
        return response
    }

    func cancel() async {
        guard let session else { return }
        let microphoneCapture = self.microphoneCapture
        self.microphoneCapture = nil
        if session.tracks.contains(.mic) {
            _ = try? await microphoneCapture?.stop()
        }
        if session.tracks.contains(.systemAudio) {
            switch activeSystemAudioCaptureMode {
            case .audioDevice:
                _ = try? await systemAudioDeviceCapture?.stop()
                systemAudioDeviceCapture = nil
            case .screenCaptureKit:
                _ = try? await systemAudioCapture?.stop()
            case .coreAudioTap:
                if #available(macOS 14.2, *) {
                    _ = try? await coreAudioTapCapture?.stop()
                }
            case nil:
                break
            }
            activeSystemAudioCaptureMode = nil
        }
        if let recordingId = session.backendRecordingId {
            try? await backend.abort(recordingId: recordingId)
        }
        try? FileManager.default.removeItem(at: session.directory)
        self.session = nil
        paused = false
        pauseStartedAt = nil
        pausedAccumulatedSeconds = 0
    }

    private func startMicrophoneCapture(
        primaryURL: URL,
        deviceID: String?,
        audioLevelSink: ((Double) -> Void)?
    ) async throws -> MicrophoneCaptureCoordinator {
        // VPIO is disabled by default. Enabling
        // `setVoiceProcessingEnabled(true)` on macOS gives us echo
        // cancellation but also forces the OS audio output through
        // the VoiceProcessing IO unit, which ducks/mutes other apps'
        // playback (Zoom, Meet, music) for the duration of the
        // recording — Ian got bitten by this mid-call. Since we
        // already capture system audio as a separate track, the
        // mix-audio job can do server-side dedup if echo ever shows
        // up. Headphone users (the typical recording-a-call case)
        // get clean mic audio either way because there's no
        // acoustic feedback path.
        let plain = makeMicrophoneCapture(
            audioLevelSink: audioLevelSink,
            liveAudioSink: onLiveAudioBuffer.map { sink in
                { buffer in sink(.microphone, buffer) }
            }
        )
        try await plain.startWithTimeout(
            deviceID: deviceID,
            outputURL: primaryURL,
            voiceProcessingEnabled: false
        )
        return plain
    }

    private func startSystemAudioDeviceCapture(
        primaryURL: URL,
        deviceID: String,
        audioLevelSink: ((Double) -> Void)?,
        liveAudioSink: ((LiveTranscriptAudioSource, AVAudioPCMBuffer) -> Void)?
    ) async throws -> MicrophoneCaptureCoordinator {
        let capture = makeMicrophoneCapture(
            audioLevelSink: audioLevelSink,
            liveAudioSink: liveAudioSink.map { sink in
                { buffer in sink(.systemAudio, buffer) }
            }
        )
        try await capture.startWithTimeout(
            deviceID: deviceID,
            outputURL: primaryURL,
            voiceProcessingEnabled: false
        )
        return capture
    }

    private func makeMicrophoneCapture(
        audioLevelSink: ((Double) -> Void)?,
        liveAudioSink: ((AVAudioPCMBuffer) -> Void)? = nil
    ) -> MicrophoneCaptureCoordinator {
        let capture = MicrophoneCaptureCoordinator()
        capture.onLevel = { level in
            audioLevelSink?(level)
        }
        capture.onPCMBuffer = { buffer in
            liveAudioSink?(buffer)
        }
        return capture
    }

    private static func createSessionDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "loom-audio-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static let minimumUsableTrackBytes: Int64 = 4096

    private static func fileSize(_ url: URL) -> Int64 {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? NSNumber
        else { return 0 }
        return size.int64Value
    }
}

enum AudioNoteRecorderError: LocalizedError {
    case alreadyRecording
    case noTracksSelected
    case notRecording
    case missingBackendRecordingId
    case missingLocalFileURL
    case systemAudioUnavailable
    case systemAudioDeviceRequired
    case noCompletedAudioTracks
    case emptyMicrophoneTrack(Int64)
    case emptySystemAudioTrack(Int64)

    var errorDescription: String? {
        switch self {
        case .alreadyRecording:
            return "An audio note is already recording."
        case .noTracksSelected:
            return "Choose microphone, system audio, or both before starting."
        case .notRecording:
            return "There is no active audio note recording to stop."
        case .missingBackendRecordingId:
            return "The audio note has no backend recording ID."
        case .missingLocalFileURL:
            return "The audio note is missing a local file path."
        case .systemAudioUnavailable:
            return "System audio capture requires macOS 14.2 or newer."
        case .systemAudioDeviceRequired:
            return "Choose a system audio device in Settings, or switch system audio back to the default system audio mode."
        case .noCompletedAudioTracks:
            return "No audio was captured. Check microphone and Screen & System Audio permissions, then try again."
        case .emptyMicrophoneTrack(let bytes):
            return "Microphone recording was empty (\(bytes) bytes). Check the selected microphone and try again."
        case .emptySystemAudioTrack(let bytes):
            return "System audio recording was empty (\(bytes) bytes). Check Screen & System Audio permission and try again."
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
