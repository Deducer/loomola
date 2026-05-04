@preconcurrency import AVFoundation
import CoreMedia
import Foundation

/// Single-source-of-truth camera session shared between the bubble
/// overlay preview AND the future composite recorder. Owns one
/// `AVCaptureSession` so two consumers never race for the same camera
/// device.
///
/// Lifecycle:
///   1. Construct (no I/O).
///   2. `start(deviceID:)` — pick the device and begin capture. Idempotent.
///   3. `previewLayer` — attach to UI to render the live preview.
///   4. `latestPixelBuffer()` — sampled by the compositor each frame.
///   5. `stop()` — tear down the session.
///
/// The sample-buffer output runs on a private serial queue. The latest
/// frame is published via an `OSAllocatedUnfairLock`-guarded slot so
/// the compositor can read at any cadence without contending with the
/// camera's delivery thread.
final class CameraCaptureCoordinator: NSObject, @unchecked Sendable {
    /// Side-channel level meter for the (future) per-camera UI. Unused
    /// today; included so the API matches the audio coordinators.
    var onFrameDelivered: (() -> Void)?

    let session: AVCaptureSession
    private let videoOutput: AVCaptureVideoDataOutput
    private let sampleQueue = DispatchQueue(
        label: "cloud.dissonance.loom.desktop.camera-samples"
    )
    // CVPixelBuffer is thread-safe in practice but isn't `Sendable` in
    // Swift's strict concurrency model, so an OSAllocatedUnfairLock with
    // a Sendable closure trips. NSLock has no such constraint.
    private let latestLock = NSLock()
    private var latestPixelBufferStorage: CVPixelBuffer?
    private var currentInput: AVCaptureDeviceInput?
    private var isStarted = false

    override init() {
        session = AVCaptureSession()
        videoOutput = AVCaptureVideoDataOutput()
        super.init()
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        videoOutput.setSampleBufferDelegate(self, queue: sampleQueue)
    }

    /// Starts capture from the specified device (or the system default
    /// when `deviceID` is nil). Idempotent — calling start twice with
    /// the same device is a no-op; calling with a different device
    /// swaps the input.
    func start(deviceID: String?) throws {
        let device = try Self.cameraDevice(id: deviceID)

        if isStarted, currentInput?.device.uniqueID == device.uniqueID {
            return
        }

        session.beginConfiguration()
        defer { session.commitConfiguration() }

        // Swap input if device changed.
        if let existing = currentInput {
            session.removeInput(existing)
            currentInput = nil
        }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw CameraCaptureCoordinatorError.cannotAddInput
        }
        session.addInput(input)
        currentInput = input

        // Wire the data output once.
        if !session.outputs.contains(videoOutput) {
            guard session.canAddOutput(videoOutput) else {
                throw CameraCaptureCoordinatorError.cannotAddOutput
            }
            session.addOutput(videoOutput)
        }

        if !session.isRunning {
            // commitConfiguration above is implicit on defer; start
            // outside the begin/commit so AVFoundation has the input
            // applied first.
        }

        if !isStarted {
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.startRunning()
            }
            isStarted = true
        }
    }

    func stop() {
        if session.isRunning {
            session.stopRunning()
        }
        latestLock.lock()
        latestPixelBufferStorage = nil
        latestLock.unlock()
        isStarted = false
    }

    /// Returns the most recently delivered camera frame's pixel buffer,
    /// or nil when no frame has arrived yet. Called by the future
    /// compositor at draw time. Cheap.
    func latestPixelBuffer() -> CVPixelBuffer? {
        latestLock.lock()
        defer { latestLock.unlock() }
        return latestPixelBufferStorage
    }

    // MARK: - Device resolution (pure, testable)

    static func cameraDevice(id: String?) throws -> AVCaptureDevice {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external],
            mediaType: .video,
            position: .unspecified
        ).devices
        if let id, let device = devices.first(where: { $0.uniqueID == id }) {
            return device
        }
        if let device = AVCaptureDevice.default(for: .video) {
            return device
        }
        throw CameraCaptureCoordinatorError.noCamera
    }

}

extension CameraCaptureCoordinator: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard sampleBuffer.isValid,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }
        latestLock.lock()
        latestPixelBufferStorage = pixelBuffer
        latestLock.unlock()
        onFrameDelivered?()
    }
}

enum CameraCaptureCoordinatorError: LocalizedError {
    case noCamera
    case cannotAddInput
    case cannotAddOutput

    var errorDescription: String? {
        switch self {
        case .noCamera:
            return "No camera was available to capture."
        case .cannotAddInput:
            return "The selected camera could not be added to the capture session."
        case .cannotAddOutput:
            return "Camera video output could not be added to the capture session."
        }
    }
}
