import AVFoundation
import CoreAudio
import Foundation
import OSLog

private let coreAudioTapLog = Logger(
    subsystem: "cloud.dissonance.loom.desktop",
    category: "core-audio-tap"
)

final class CoreAudioTapCaptureCoordinator: @unchecked Sendable {
    var onLevel: ((Double) -> Void)?
    var onPCMBuffer: ((AVAudioPCMBuffer) -> Void)?

    private let sampleQueue = DispatchQueue(label: "cloud.dissonance.loom.desktop.core-audio-tap-samples")
    private var writer: AudioAssetWriter?
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private var format: AVAudioFormat?
    private var outputURL: URL?
    private var paused = false

    var isPaused: Bool {
        get { paused }
        set { paused = newValue }
    }

    @available(macOS 14.2, *)
    func start(outputURL: URL) throws {
        guard writer == nil else {
            throw CoreAudioTapCaptureError.alreadyRecording
        }

        self.outputURL = outputURL
        do {
            let tapDescription = CATapDescription(
                stereoGlobalTapButExcludeProcesses: currentProcessObjectID().map { [$0] } ?? []
            )
            tapDescription.name = "Loomola System Audio"
            tapDescription.isPrivate = true
            tapDescription.muteBehavior = CATapMuteBehavior.unmuted

            var tapID = AudioObjectID(kAudioObjectUnknown)
            try check(
                AudioHardwareCreateProcessTap(tapDescription, &tapID),
                context: "create process tap"
            )
            self.tapID = tapID

            let tapUID = try readTapUID(tapID)
            var asbd = try readTapFormat(tapID)
            guard let format = AVAudioFormat(streamDescription: &asbd) else {
                throw CoreAudioTapCaptureError.cannotBuildAudioFormat
            }
            self.format = format

            let writer = try AudioAssetWriter(
                outputURL: outputURL,
                sampleRate: format.sampleRate,
                channelCount: Int(format.channelCount)
            )
            try writer.start()
            self.writer = writer

            let aggregateUID = "cloud.dissonance.loomola.system-audio.\(UUID().uuidString)"
            let aggregateDescription: [String: Any] = [
                kAudioAggregateDeviceNameKey: "Loomola System Audio",
                kAudioAggregateDeviceUIDKey: aggregateUID,
                kAudioAggregateDeviceIsPrivateKey: true,
                kAudioAggregateDeviceTapListKey: [
                    [
                        kAudioSubTapUIDKey: tapUID,
                        kAudioSubTapDriftCompensationKey: true,
                        kAudioSubTapDriftCompensationQualityKey: kAudioAggregateDriftCompensationHighQuality
                    ]
                ]
            ]

            var aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
            try check(
                AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateDeviceID),
                context: "create aggregate device"
            )
            self.aggregateDeviceID = aggregateDeviceID

            var ioProcID: AudioDeviceIOProcID?
            let block: AudioDeviceIOBlock = { [weak self] _, inputData, _, _, _ in
                self?.handleInputData(inputData)
            }
            try check(
                AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateDeviceID, sampleQueue, block),
                context: "create IO proc"
            )
            self.ioProcID = ioProcID

            try check(
                AudioDeviceStart(aggregateDeviceID, ioProcID),
                context: "start aggregate device"
            )

            coreAudioTapLog.notice("Core Audio Tap system capture started")
        } catch {
            cleanupAudioObjects()
            writer = nil
            format = nil
            self.outputURL = nil
            throw error
        }
    }

    @available(macOS 14.2, *)
    func stop() async throws -> URL {
        guard let writer, let outputURL else {
            throw CoreAudioTapCaptureError.notRecording
        }
        cleanupAudioObjects()
        self.writer = nil
        self.format = nil
        self.outputURL = nil
        _ = try await writer.finish()
        coreAudioTapLog.notice("Core Audio Tap system capture stopped")
        return outputURL
    }

    private func handleInputData(_ inputData: UnsafePointer<AudioBufferList>) {
        if paused { return }
        guard let format, let writer else { return }
        guard let pcmBuffer = makePCMBuffer(from: inputData, format: format) else { return }
        try? writer.append(pcmBuffer)
        onPCMBuffer?(pcmBuffer)
        if let level = AudioLevelSampler.linearLevel(from: pcmBuffer) {
            onLevel?(level)
        }
    }

    @available(macOS 14.2, *)
    private func cleanupAudioObjects() {
        if aggregateDeviceID != kAudioObjectUnknown {
            if let ioProcID {
                _ = AudioDeviceStop(aggregateDeviceID, ioProcID)
                _ = AudioDeviceDestroyIOProcID(aggregateDeviceID, ioProcID)
            }
            _ = AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
        }
        if tapID != kAudioObjectUnknown {
            _ = AudioHardwareDestroyProcessTap(tapID)
        }
        ioProcID = nil
        aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
    }
}

@available(macOS 14.2, *)
private func readTapUID(_ tapID: AudioObjectID) throws -> CFString {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioTapPropertyUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var dataSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var unmanaged: Unmanaged<CFString>?
    try check(
        AudioObjectGetPropertyData(tapID, &address, 0, nil, &dataSize, &unmanaged),
        context: "read tap uid"
    )
    guard let unmanaged else {
        throw CoreAudioTapCaptureError.missingTapUID
    }
    return unmanaged.takeRetainedValue()
}

@available(macOS 14.2, *)
private func readTapFormat(_ tapID: AudioObjectID) throws -> AudioStreamBasicDescription {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioTapPropertyFormat,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var description = AudioStreamBasicDescription()
    var dataSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    try check(
        AudioObjectGetPropertyData(tapID, &address, 0, nil, &dataSize, &description),
        context: "read tap format"
    )
    return description
}

@available(macOS 14.2, *)
private func currentProcessObjectID() -> AudioObjectID? {
    var pid = pid_t(ProcessInfo.processInfo.processIdentifier)
    var processObjectID = AudioObjectID(kAudioObjectUnknown)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var dataSize = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = withUnsafePointer(to: &pid) { pidPointer in
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            UInt32(MemoryLayout<pid_t>.size),
            pidPointer,
            &dataSize,
            &processObjectID
        )
    }
    if status != noErr || processObjectID == kAudioObjectUnknown {
        return nil
    }
    return processObjectID
}

private func makePCMBuffer(
    from inputData: UnsafePointer<AudioBufferList>,
    format: AVAudioFormat
) -> AVAudioPCMBuffer? {
    let sourceBuffers = UnsafeMutableAudioBufferListPointer(
        UnsafeMutablePointer(mutating: inputData)
    )
    guard let firstBuffer = sourceBuffers.first else { return nil }

    let bytesPerFrame = Int(max(format.streamDescription.pointee.mBytesPerFrame, 1))
    let frameCount = Int(firstBuffer.mDataByteSize) / bytesPerFrame
    guard frameCount > 0 else { return nil }
    guard let pcmBuffer = AVAudioPCMBuffer(
        pcmFormat: format,
        frameCapacity: AVAudioFrameCount(frameCount)
    ) else { return nil }
    pcmBuffer.frameLength = AVAudioFrameCount(frameCount)

    let destinationBuffers = UnsafeMutableAudioBufferListPointer(pcmBuffer.mutableAudioBufferList)
    let copyCount = min(sourceBuffers.count, destinationBuffers.count)
    for index in 0..<copyCount {
        guard let source = sourceBuffers[index].mData,
              let destination = destinationBuffers[index].mData
        else { continue }
        let byteCount = min(
            Int(sourceBuffers[index].mDataByteSize),
            Int(destinationBuffers[index].mDataByteSize)
        )
        memcpy(destination, source, byteCount)
        destinationBuffers[index].mDataByteSize = UInt32(byteCount)
    }
    return pcmBuffer
}

@available(macOS 14.2, *)
private func check(_ status: OSStatus, context: String) throws {
    guard status == noErr else {
        coreAudioTapLog.error("Core Audio Tap failed: \(context, privacy: .public) status=\(status, privacy: .public)")
        throw CoreAudioTapCaptureError.coreAudioFailure(context: context, status: status)
    }
}

enum CoreAudioTapCaptureError: LocalizedError {
    case alreadyRecording
    case notRecording
    case missingTapUID
    case cannotBuildAudioFormat
    case coreAudioFailure(context: String, status: OSStatus)

    var errorDescription: String? {
        switch self {
        case .alreadyRecording:
            return "System audio is already recording."
        case .notRecording:
            return "There is no active system audio recording to stop."
        case .missingTapUID:
            return "System audio tap did not provide an audio stream identifier."
        case .cannotBuildAudioFormat:
            return "System audio tap returned an unsupported audio format."
        case .coreAudioFailure(let context, let status):
            return "System audio capture failed while trying to \(context) (OSStatus \(status))."
        }
    }
}
