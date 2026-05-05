@preconcurrency import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import Foundation

/// Real composite recorder. Takes screen frames + camera frames + the
/// live `BubblePlacement` and produces an MP4 at `outputURL` containing:
///
///   • a single H.264 video track at the screen's pixel dimensions, with
///     the camera bubble drawn at the user's drag position via CoreImage
///     (clipped to circle or rectangle based on `BubblePlacement.shape`);
///   • a single AAC audio track from the mic (with AEC applied upstream).
///
/// Drives off the screen sample-buffer callback for timing — every screen
/// frame triggers one composite + append, using the screen frame's PTS as
/// the master clock. Camera frames are sampled at append time (no PTS
/// correlation), introducing up to ~33 ms of jitter that's invisible at
/// 30 fps.
///
/// System audio mixing is not in this slice — system audio is uploaded as
/// the existing raw track and can be mixed server-side via ffmpeg if the
/// user wants. Pause/resume PTS arithmetic is also deferred.
@available(macOS 14.0, *)
final class CompositeRecorder: @unchecked Sendable {
    private(set) var outputURL: URL?

    private let bubbleController: BubblePositionController
    private let cameraCoordinator: CameraCaptureCoordinator
    private let displayBoundsProvider: () -> DisplayPixelBounds?

    private var writer: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioInput: AVAssetWriterInput?
    private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?

    private let ciContext: CIContext

    private let stateLock = NSLock()
    nonisolated(unsafe) private var sessionStarted = false
    nonisolated(unsafe) private var startedAtPTS: CMTime = .invalid
    nonisolated(unsafe) private var outputSize: CGSize = .zero
    nonisolated(unsafe) private var hasFinished = false

    init(
        bubbleController: BubblePositionController,
        cameraCoordinator: CameraCaptureCoordinator,
        displayBoundsProvider: @escaping () -> DisplayPixelBounds?
    ) {
        self.bubbleController = bubbleController
        self.cameraCoordinator = cameraCoordinator
        self.displayBoundsProvider = displayBoundsProvider
        // GPU-backed Core Image context. Render to CVPixelBuffer is fast
        // and integrates cleanly with the asset writer's pixel-buffer
        // adaptor.
        self.ciContext = CIContext(options: [
            .workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB) as Any
        ])
    }

    func prepare(outputURL: URL, frameSize: CGSize) throws {
        self.outputURL = outputURL
        self.outputSize = frameSize

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

        // Video input: H.264, source pixel buffers in BGRA. Ample
        // bitrate budget for 1440p screen capture (real bitrate use is
        // much lower for typical desktop content).
        // Scale bitrate by resolution. 12 Mbps was undersized for 4K
        // (~8 Mp) — the encoder ran out of budget on motion regions
        // and left visible compensation residual ("trails") behind
        // moving content like a dragged camera bubble. Target ~0.6
        // bits-per-pixel-frame at 30fps base, capped at 50 Mbps so
        // even a 5K Studio Display doesn't blow up the file size.
        let pixels = max(1, Int(frameSize.width) * Int(frameSize.height))
        let scaledBitrate = min(50_000_000, max(8_000_000, Int(Double(pixels) * 6.0)))

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(frameSize.width),
            AVVideoHeightKey: Int(frameSize.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: scaledBitrate,
                AVVideoMaxKeyFrameIntervalKey: 60,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: 30,
            ],
        ]
        let videoInput = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: videoSettings
        )
        videoInput.expectsMediaDataInRealTime = true
        guard writer.canAdd(videoInput) else {
            throw CompositeRecorderError.cannotAddVideoInput
        }
        writer.add(videoInput)
        self.videoInput = videoInput

        let pixelBufferAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: Int(frameSize.width),
                kCVPixelBufferHeightKey as String: Int(frameSize.height),
            ]
        )
        self.pixelBufferAdaptor = pixelBufferAdaptor

        // Audio input: AAC mono 48k. Mic-only for v1.
        let audioSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 128_000,
        ]
        let audioInput = AVAssetWriterInput(
            mediaType: .audio,
            outputSettings: audioSettings
        )
        audioInput.expectsMediaDataInRealTime = true
        if writer.canAdd(audioInput) {
            writer.add(audioInput)
            self.audioInput = audioInput
        }

        guard writer.startWriting() else {
            throw writer.error ?? CompositeRecorderError.couldNotStartWriting
        }

        self.writer = writer

        // Pre-allocate the pixel-buffer pool by touching its accessor.
        _ = pixelBufferAdaptor.pixelBufferPool
    }

    /// Called from the screen sample-buffer callback (off the main
    /// actor, on the SCStream sample queue). Composes one frame and
    /// appends to the asset writer.
    func appendScreenFrame(_ sampleBuffer: CMSampleBuffer) {
        guard let writer,
              let videoInput,
              let pixelBufferAdaptor,
              videoInput.isReadyForMoreMediaData
        else { return }

        guard let screenPixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if !pts.isValid || pts.isIndefinite { return }

        stateLock.lock()
        let starting = !sessionStarted
        if starting {
            sessionStarted = true
            startedAtPTS = pts
        }
        stateLock.unlock()
        if starting {
            writer.startSession(atSourceTime: pts)
        }

        let compositeImage = composite(screenPixelBuffer: screenPixelBuffer)

        guard let pool = pixelBufferAdaptor.pixelBufferPool else { return }
        var destination: CVPixelBuffer?
        let status = CVPixelBufferPoolCreatePixelBuffer(
            kCFAllocatorDefault,
            pool,
            &destination
        )
        guard status == kCVReturnSuccess, let destination else { return }

        ciContext.render(
            compositeImage,
            to: destination,
            bounds: CGRect(origin: .zero, size: outputSize),
            colorSpace: CGColorSpace(name: CGColorSpace.sRGB)
        )

        if !pixelBufferAdaptor.append(destination, withPresentationTime: pts) {
            // Most append failures are transient (input not ready) — we
            // just drop the frame. Hard failures surface in finish().
        }
    }

    /// Called from the mic tap thread. Drops samples when the video
    /// session hasn't started yet (no master clock), to avoid audio
    /// leading video.
    func appendMicSample(_ sampleBuffer: CMSampleBuffer) {
        guard let audioInput,
              audioInput.isReadyForMoreMediaData
        else { return }
        stateLock.lock()
        let started = sessionStarted
        stateLock.unlock()
        if !started { return }
        _ = audioInput.append(sampleBuffer)
    }

    /// Finalizes the writer and returns the output URL. Idempotent.
    func finish() async throws -> URL {
        guard let writer, let outputURL else {
            throw CompositeRecorderError.notPrepared
        }
        // Idempotency check + flag flip done synchronously so we don't
        // hold an NSLock across an await suspension point (illegal in
        // Swift 6 strict-concurrency).
        let alreadyFinished = markFinishedIfNeeded()
        if alreadyFinished {
            return outputURL
        }

        videoInput?.markAsFinished()
        audioInput?.markAsFinished()

        let writerBox = CompositeAssetWriterBox(writer)
        return try await withCheckedThrowingContinuation { continuation in
            let box = AssetWriterContinuationBox(continuation, outputURL: outputURL)
            writerBox.finishWriting {
                if let error = writerBox.error {
                    box.resume(throwing: error)
                    return
                }
                box.resume(returning: outputURL)
            }
            // Safety net — finishWriting normally completes within a
            // couple of seconds. 10s is generous.
            Task {
                try? await Task.sleep(for: .seconds(10))
                box.resume(throwing: CompositeRecorderError.finishTimedOut)
            }
        }
    }

    /// Returns true if `finish` was already called (caller short-circuits).
    /// Returns false and atomically sets the flag when this is the first
    /// finish call.
    private func markFinishedIfNeeded() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        if hasFinished { return true }
        hasFinished = true
        return false
    }

    // MARK: - Composition

    private func composite(screenPixelBuffer: CVPixelBuffer) -> CIImage {
        let screenImage = CIImage(cvPixelBuffer: screenPixelBuffer)

        guard let cameraPixelBuffer = cameraCoordinator.latestPixelBuffer(),
              let bubblePlacement = bubbleController.current(),
              let displayBounds = displayBoundsProvider(),
              let bubblePixelRect = bubblePlacement.pixelRect(in: displayBounds)
        else {
            return screenImage
        }

        let cameraImage = CIImage(cvPixelBuffer: cameraPixelBuffer)

        // Scale + crop the camera frame to fill the bubble rect while
        // preserving aspect (cover-fit, like the on-screen preview's
        // `.resizeAspectFill`).
        let scaledCamera = aspectFill(
            image: cameraImage,
            into: bubblePixelRect.size
        )

        // Position the camera within the screen frame. CoreImage uses a
        // y-up coordinate system; pixelRect uses y-down (matches
        // ScreenCaptureKit). Convert.
        let yUpY = outputSize.height - bubblePixelRect.maxY
        let translated = scaledCamera.transformed(
            by: CGAffineTransform(
                translationX: bubblePixelRect.minX,
                y: yUpY
            )
        )

        let masked: CIImage
        switch bubblePlacement.shape {
        case .circle:
            masked = applyCircularMask(
                to: translated,
                circleRect: CGRect(
                    x: bubblePixelRect.minX,
                    y: yUpY,
                    width: bubblePixelRect.width,
                    height: bubblePixelRect.height
                )
            )
        case .rectangle:
            masked = translated
        }

        return masked.composited(over: screenImage)
    }

    private func aspectFill(image: CIImage, into size: CGSize) -> CIImage {
        let extent = image.extent
        guard extent.width > 0, extent.height > 0,
              size.width > 0, size.height > 0
        else { return image }
        let scaleX = size.width / extent.width
        let scaleY = size.height / extent.height
        let scale = max(scaleX, scaleY)
        let scaled = image.transformed(
            by: CGAffineTransform(scaleX: scale, y: scale)
        )
        let scaledExtent = scaled.extent
        let cropX = (scaledExtent.width - size.width) / 2 + scaledExtent.origin.x
        let cropY = (scaledExtent.height - size.height) / 2 + scaledExtent.origin.y
        let cropped = scaled.cropped(
            to: CGRect(
                x: cropX,
                y: cropY,
                width: size.width,
                height: size.height
            )
        )
        return cropped.transformed(
            by: CGAffineTransform(
                translationX: -cropped.extent.origin.x,
                y: -cropped.extent.origin.y
            )
        )
    }

    private func applyCircularMask(
        to image: CIImage,
        circleRect: CGRect
    ) -> CIImage {
        // Use a CIRadialGradient as the alpha mask: opaque inside the
        // circle, transparent outside, with a 1-pixel feather to soften
        // the edge. CIBlendWithMask uses the gradient's luminance as
        // the alpha source.
        guard let gradientFilter = CIFilter(name: "CIRadialGradient") else {
            return image
        }
        let centerX = circleRect.midX
        let centerY = circleRect.midY
        let radius = min(circleRect.width, circleRect.height) / 2
        gradientFilter.setValue(
            CIVector(x: centerX, y: centerY),
            forKey: "inputCenter"
        )
        gradientFilter.setValue(radius - 1, forKey: "inputRadius0")
        gradientFilter.setValue(radius, forKey: "inputRadius1")
        gradientFilter.setValue(CIColor.white, forKey: "inputColor0")
        gradientFilter.setValue(
            CIColor(red: 0, green: 0, blue: 0, alpha: 0),
            forKey: "inputColor1"
        )
        guard let mask = gradientFilter.outputImage else { return image }

        guard let blendFilter = CIFilter(name: "CIBlendWithMask") else {
            return image
        }
        blendFilter.setValue(image, forKey: kCIInputImageKey)
        blendFilter.setValue(mask, forKey: kCIInputMaskImageKey)
        // Background is implicit transparent — the masked-out pixels
        // are clear, which is what we want before compositing over
        // the screen.
        return blendFilter.outputImage ?? image
    }
}

/// Sendable wrapper so we can pass an AVAssetWriter into the
/// finishWriting completion closure without tripping strict-concurrency.
/// AVAssetWriter is documented thread-safe for the access we need.
private final class CompositeAssetWriterBox: @unchecked Sendable {
    private let writer: AVAssetWriter

    init(_ writer: AVAssetWriter) {
        self.writer = writer
    }

    var error: Error? { writer.error }

    func finishWriting(_ completionHandler: @escaping @Sendable () -> Void) {
        writer.finishWriting(completionHandler: completionHandler)
    }
}

private final class AssetWriterContinuationBox: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URL, Error>?
    let outputURL: URL

    init(_ continuation: CheckedContinuation<URL, Error>, outputURL: URL) {
        self.continuation = continuation
        self.outputURL = outputURL
    }

    func resume(returning value: URL) {
        let c = take()
        c?.resume(returning: value)
    }

    func resume(throwing error: Error) {
        let c = take()
        c?.resume(throwing: error)
    }

    private func take() -> CheckedContinuation<URL, Error>? {
        lock.lock()
        defer { lock.unlock() }
        let c = continuation
        continuation = nil
        return c
    }
}

enum CompositeRecorderError: LocalizedError {
    case notPrepared
    case cannotAddVideoInput
    case couldNotStartWriting
    case finishTimedOut

    var errorDescription: String? {
        switch self {
        case .notPrepared:
            return "Composite recorder was not prepared with an output URL."
        case .cannotAddVideoInput:
            return "Could not add the video input to the asset writer."
        case .couldNotStartWriting:
            return "Composite asset writer could not start writing."
        case .finishTimedOut:
            return "Composite recorder finish operation timed out."
        }
    }
}
