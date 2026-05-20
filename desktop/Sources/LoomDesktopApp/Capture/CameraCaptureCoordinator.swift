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
///   4. `pixelBuffer(closestTo:)` — sampled by the compositor each frame.
///   5. `stop()` — tear down the session.
///
/// The sample-buffer output runs on a private serial queue. Recent frames
/// are published behind a lock so the compositor can pick the camera frame
/// closest to the screen frame's PTS instead of drawing an ahead-of-time
/// live frame into a delayed ScreenCaptureKit callback.
final class CameraCaptureCoordinator: NSObject, @unchecked Sendable {
    /// Side-channel level meter for the (future) per-camera UI. Unused
    /// today; included so the API matches the audio coordinators.
    var onFrameDelivered: (() -> Void)?

    /// One-per-process shared instance so the bubble overlay (in
    /// AppDelegate) and the composite recorder (in RecorderViewModel)
    /// see the same camera session — never two sessions on one device.
    static let shared = CameraCaptureCoordinator()

    let session: AVCaptureSession
    private let videoOutput: AVCaptureVideoDataOutput
    private let sampleQueue = DispatchQueue(
        label: "cloud.dissonance.loom.desktop.camera-samples"
    )
    // CVPixelBuffer is thread-safe in practice but isn't `Sendable` in
    // Swift's strict concurrency model, so an OSAllocatedUnfairLock with
    // a Sendable closure trips. NSLock has no such constraint.
    private let latestLock = NSLock()
    private var frameHistory = CameraFrameHistory<CVPixelBuffer>(capacity: 90)
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
        if session.canSetSessionPreset(.vga640x480) {
            session.sessionPreset = .vga640x480
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
        frameHistory.removeAll()
        latestLock.unlock()
        isStarted = false
    }

    /// Convenience for UI consumers: handles the camera permission
    /// prompt + starts the session on grant. Errors are logged rather
    /// than thrown — UI doesn't have a great recovery path beyond
    /// "the bubble preview is gray." Idempotent: if already started
    /// with the requested device, no-op.
    func requestPermissionAndStart(deviceID: String?) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            tryStart(deviceID: deviceID)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                guard granted else { return }
                Task { @MainActor in
                    self?.tryStart(deviceID: deviceID)
                }
            }
        case .denied, .restricted:
            // Nothing to do — the UI will render its purple
            // placeholder background. Users can re-grant in System
            // Settings → Privacy & Security → Camera.
            break
        @unknown default:
            break
        }
    }

    private func tryStart(deviceID: String?) {
        do {
            try start(deviceID: deviceID)
        } catch {
            print("[camera] start failed: \(error.localizedDescription)")
        }
    }

    /// Returns the most recently delivered camera frame's pixel buffer,
    /// or nil when no frame has arrived yet. Used by the live preview.
    func latestPixelBuffer() -> CVPixelBuffer? {
        latestLock.lock()
        defer { latestLock.unlock() }
        return frameHistory.latest()
    }

    /// Returns the camera frame closest to the requested media timestamp.
    /// Used by the MP4 compositor to keep the drawn bubble in the same
    /// timeline as screen and mic samples.
    func pixelBuffer(closestTo presentationTime: CMTime) -> CVPixelBuffer? {
        latestLock.lock()
        defer { latestLock.unlock() }
        return frameHistory.closest(to: presentationTime)
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
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if !pts.isValid || pts.isIndefinite { return }
        latestLock.lock()
        frameHistory.append(pixelBuffer, presentationTime: pts)
        latestLock.unlock()
        onFrameDelivered?()
    }
}

struct CameraFrameHistory<Frame> {
    private struct Entry {
        let frame: Frame
        let presentationTime: CMTime
    }

    private let capacity: Int
    private var entries: [Entry] = []

    init(capacity: Int) {
        self.capacity = max(1, capacity)
    }

    var count: Int {
        entries.count
    }

    mutating func append(_ frame: Frame, presentationTime: CMTime) {
        guard presentationTime.isValid, !presentationTime.isIndefinite else { return }
        entries.append(Entry(frame: frame, presentationTime: presentationTime))
        if entries.count > capacity {
            entries.removeFirst(entries.count - capacity)
        }
    }

    mutating func removeAll() {
        entries.removeAll()
    }

    func latest() -> Frame? {
        entries.last?.frame
    }

    func closest(to presentationTime: CMTime) -> Frame? {
        guard presentationTime.isValid, !presentationTime.isIndefinite else {
            return latest()
        }

        let maxTolerance = 3.0
        guard let best = entries.min(by: {
            distance($0.presentationTime, presentationTime)
                < distance($1.presentationTime, presentationTime)
        }) else {
            return nil
        }

        if distance(best.presentationTime, presentationTime) <= maxTolerance {
            return best.frame
        }
        return latest()
    }

    private func distance(_ lhs: CMTime, _ rhs: CMTime) -> Double {
        let seconds = CMTimeGetSeconds(CMTimeSubtract(lhs, rhs))
        if seconds.isFinite {
            return abs(seconds)
        }
        return .infinity
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
