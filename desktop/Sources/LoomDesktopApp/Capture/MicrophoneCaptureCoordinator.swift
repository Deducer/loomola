import AVFoundation
import Foundation

final class MicrophoneCaptureCoordinator: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    private var session: AVCaptureSession?
    private var writer: AudioAssetWriter?
    private let sampleQueue = DispatchQueue(label: "cloud.dissonance.loom.desktop.mic-samples")

    func start(deviceID: String?, outputURL: URL) throws {
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
        session = captureSession
        captureSession.startRunning()
    }

    func stop() async throws -> URL {
        guard let session, let writer else {
            throw MicrophoneCaptureCoordinatorError.notRecording
        }
        session.stopRunning()
        self.session = nil
        self.writer = nil
        return try await writer.finish()
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        try? writer?.append(sampleBuffer)
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
}

enum MicrophoneCaptureCoordinatorError: LocalizedError {
    case noMicrophone
    case cannotAddInput
    case cannotAddOutput
    case notRecording

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
        }
    }
}
