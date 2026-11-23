import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import os.log

private let screenshotLog = Logger(subsystem: "cloud.dissonance.loom.desktop", category: "screenshots")

/// One kept frame of the meeting window, ready to upload.
struct MeetingScreenshot: Sendable {
    let jpeg: Data
    /// Recorded-audio time, so it lines up with transcript word times.
    let offsetMs: Int
    let windowTitle: String
    let pixelWidth: Int
    let pixelHeight: Int
}

enum MeetingScreenshotUploadOutcome: String, Sendable {
    case stored
    /// The server's model saw participants only; the frame was not stored.
    case noSharedContent
    /// The note already holds as many screenshots as the server allows.
    case limitReached
    case failed
}

/// Where the recording is, asked before every sample.
enum MeetingScreenshotClock: Sendable {
    case recording(seconds: TimeInterval)
    case paused
    case ended
}

/// What one pass of the loop saw. Used by the self-test and the log.
struct MeetingScreenshotSample: Sendable {
    let seconds: TimeInterval
    let windowTitle: String?
    let verdict: ScreenshotChangeDetector.Verdict
    let outcome: MeetingScreenshotUploadOutcome?
}

struct MeetingWindowCandidate: Equatable, Sendable {
    let id: CGWindowID
    let title: String
    let applicationName: String
    let bounds: CGRect
}

/// While an audio note records, looks at the meeting window every few seconds
/// (two frames a moment apart) and hands the frames that
/// `ScreenshotChangeDetector` keeps to `upload`.
/// Only a window `MeetingWindowMatcher` accepts is ever captured.
@available(macOS 14.0, *)
final class MeetingScreenshotCapturer: @unchecked Sendable {
    typealias Clock = @Sendable () async -> MeetingScreenshotClock
    typealias Upload = @Sendable (MeetingScreenshot) async -> MeetingScreenshotUploadOutcome
    typealias SampleObserver = @Sendable (MeetingScreenshotSample) -> Void

    static let defaultSampleInterval: TimeInterval = 6
    /// Gap between the two frames of one look. Long enough for a scroll or a
    /// transition to show as movement, short enough that a screen someone
    /// has just clicked to still counts as holding still.
    static let pairInterval: TimeInterval = 0.7
    /// Longest side of a stored frame, in pixels. Enough to read slide text.
    static let maxLongSide: CGFloat = 1600
    /// Smaller windows are picture-in-picture strips or a call parked in the
    /// Stage Manager strip (a thumbnail), not a readable call window.
    static let minimumWindowSize = CGSize(width: 480, height: 270)

    private let sampleInterval: TimeInterval
    private let clock: Clock
    private let upload: Upload
    private let onSample: SampleObserver?
    private let lock = NSLock()
    private var task: Task<Void, Never>?

    init(
        sampleInterval: TimeInterval = MeetingScreenshotCapturer.defaultSampleInterval,
        clock: @escaping Clock,
        upload: @escaping Upload,
        onSample: SampleObserver? = nil
    ) {
        self.sampleInterval = sampleInterval
        self.clock = clock
        self.upload = upload
        self.onSample = onSample
    }

    deinit { task?.cancel() }

    func start() {
        lock.lock()
        defer { lock.unlock() }
        guard task == nil else { return }
        let interval = sampleInterval
        let clock = clock
        let upload = upload
        let onSample = onSample
        task = Task.detached(priority: .utility) {
            await Self.run(sampleInterval: interval, clock: clock, upload: upload, onSample: onSample)
        }
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        task?.cancel()
        task = nil
    }

    private static func run(
        sampleInterval: TimeInterval,
        clock: Clock,
        upload: Upload,
        onSample: SampleObserver?
    ) async {
        var detector = ScreenshotChangeDetector()
        var cachedWindow: SCWindow?
        // Tallied for the one summary line logged when the loop ends, which
        // is what there is to go on when a call produced too few or too many.
        var samples = 0
        var samplesWithWindow = 0
        var samplesWithParkedWindow = 0
        var unsettledSamples = 0
        screenshotLog.notice("meeting screenshots started")
        defer {
            screenshotLog.notice("meeting screenshots summary: samples=\(samples, privacy: .public) withCallWindow=\(samplesWithWindow, privacy: .public) callWindowParked=\(samplesWithParkedWindow, privacy: .public) unsettled=\(unsettledSamples, privacy: .public) kept=\(detector.keptCount, privacy: .public) sent=\(detector.attemptCount, privacy: .public)")
        }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(sampleInterval * 1_000_000_000))
            if Task.isCancelled { break }
            let seconds: TimeInterval
            switch await clock() {
            case .ended:
                screenshotLog.notice("meeting screenshots stopped: recording ended (kept=\(detector.keptCount, privacy: .public))")
                return
            case .paused:
                continue
            case .recording(let elapsed):
                seconds = elapsed
            }
            if detector.isExhausted {
                screenshotLog.notice("meeting screenshots stopped: limit reached (kept=\(detector.keptCount, privacy: .public), sent=\(detector.attemptCount, privacy: .public))")
                return
            }

            samples += 1
            let windows = onScreenWindows()
            guard let candidate = largestMeetingWindow(in: windows) else {
                // A call window that is there but tiny is parked in the Stage
                // Manager strip: macOS only renders it as a thumbnail, so
                // there is nothing readable to capture until it is in front.
                if windows.contains(where: {
                    MeetingWindowMatcher.isMeetingWindow(applicationName: $0.applicationName, title: $0.title)
                }) {
                    samplesWithParkedWindow += 1
                }
                onSample?(MeetingScreenshotSample(
                    seconds: seconds, windowTitle: nil, verdict: .init(), outcome: nil
                ))
                continue
            }
            if cachedWindow?.windowID != candidate.id || cachedWindow?.frame.size != candidate.bounds.size {
                cachedWindow = await shareableWindow(id: candidate.id)
            }
            guard let window = cachedWindow, let firstImage = await captureImage(of: window) else {
                cachedWindow = nil
                continue
            }
            try? await Task.sleep(nanoseconds: UInt64(pairInterval * 1_000_000_000))
            guard !Task.isCancelled, let image = await captureImage(of: window) else {
                cachedWindow = nil
                continue
            }

            samplesWithWindow += 1
            let verdict = detector.consider(
                first: signature(of: firstImage),
                second: signature(of: image),
                at: seconds
            )
            if let moved = verdict.movedWithinPair, moved > detector.screenSettledShare {
                unsettledSamples += 1
            }
            var outcome: MeetingScreenshotUploadOutcome?
            if verdict.keep {
                if let jpeg = jpegData(from: image) {
                    outcome = await upload(MeetingScreenshot(
                        jpeg: jpeg,
                        offsetMs: Int((seconds * 1000).rounded()),
                        windowTitle: candidate.title,
                        pixelWidth: image.width,
                        pixelHeight: image.height
                    ))
                } else {
                    outcome = .failed
                }
                switch outcome {
                case .noSharedContent: detector.lastKeepWasRejected(at: seconds)
                case .failed: detector.lastKeepFailed()
                case .stored, .limitReached, .none: break
                }
                screenshotLog.notice("meeting screenshot at \(Int(seconds), privacy: .public)s → \(outcome?.rawValue ?? "none", privacy: .public)")
            }
            onSample?(MeetingScreenshotSample(
                seconds: seconds, windowTitle: candidate.title, verdict: verdict, outcome: outcome
            ))
            if outcome == .limitReached {
                screenshotLog.notice("meeting screenshots stopped: note is at the server's limit")
                return
            }
        }
    }

    // MARK: - Finding the window

    /// Core Graphics lists windows cheaply; ScreenCaptureKit's shareable
    /// content is only rebuilt when a call window is actually there.
    static func onScreenWindows() -> [MeetingWindowCandidate] {
        guard let raw = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else { return [] }
        return raw.compactMap { info in
            guard (info[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  let owner = info[kCGWindowOwnerName as String] as? String,
                  let title = info[kCGWindowName as String] as? String,
                  let id = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                  let boundsDictionary = info[kCGWindowBounds as String] as? [String: Any],
                  let bounds = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary)
            else { return nil }
            return MeetingWindowCandidate(id: id, title: title, applicationName: owner, bounds: bounds)
        }
    }

    static func largestMeetingWindow(in windows: [MeetingWindowCandidate]) -> MeetingWindowCandidate? {
        windows
            .filter { window in
                window.bounds.width >= minimumWindowSize.width
                    && window.bounds.height >= minimumWindowSize.height
                    && MeetingWindowMatcher.isMeetingWindow(
                        applicationName: window.applicationName,
                        title: window.title
                    )
            }
            .max { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }
    }

    private static func shareableWindow(id: CGWindowID) async -> SCWindow? {
        let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        return content?.windows.first { $0.windowID == id }
    }

    // MARK: - Capturing

    private static func captureImage(of window: SCWindow) async -> CGImage? {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = CGFloat(filter.pointPixelScale)
        let size = fittedSize(
            width: window.frame.width * scale,
            height: window.frame.height * scale,
            maxLongSide: maxLongSide
        )
        let configuration = SCStreamConfiguration()
        configuration.width = Int(size.width)
        configuration.height = Int(size.height)
        configuration.showsCursor = false
        do {
            return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        } catch {
            screenshotLog.error("meeting screenshot capture failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    static func fittedSize(width: CGFloat, height: CGFloat, maxLongSide: CGFloat) -> CGSize {
        let longSide = max(width, height)
        guard longSide > maxLongSide, longSide > 0 else {
            return CGSize(width: max(1, width.rounded()), height: max(1, height.rounded()))
        }
        let ratio = maxLongSide / longSide
        return CGSize(width: max(1, (width * ratio).rounded()), height: max(1, (height * ratio).rounded()))
    }

    /// Grayscale grid for `ScreenshotChangeDetector`. Shrunk in two steps so
    /// each cell is an average of its area, not one sampled pixel.
    static func signature(of image: CGImage) -> [UInt8] {
        let width = ScreenshotChangeDetector.gridWidth
        let height = ScreenshotChangeDetector.gridHeight
        guard let intermediate = grayscale(image, width: width * 4, height: height * 4),
              let intermediateImage = intermediate.context.makeImage(),
              let final = grayscale(intermediateImage, width: width, height: height)
        else { return [] }
        return final.pixels()
    }

    private final class GrayBitmap {
        let context: CGContext
        private let storage: UnsafeMutablePointer<UInt8>
        private let count: Int

        init?(width: Int, height: Int) {
            count = width * height
            storage = UnsafeMutablePointer<UInt8>.allocate(capacity: count)
            storage.initialize(repeating: 0, count: count)
            guard let context = CGContext(
                data: storage,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else {
                storage.deallocate()
                return nil
            }
            self.context = context
        }

        deinit { storage.deallocate() }

        func pixels() -> [UInt8] { Array(UnsafeBufferPointer(start: storage, count: count)) }
    }

    private static func grayscale(_ image: CGImage, width: Int, height: Int) -> GrayBitmap? {
        guard let bitmap = GrayBitmap(width: width, height: height) else { return nil }
        bitmap.context.interpolationQuality = .high
        bitmap.context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return bitmap
    }

    static func jpegData(from image: CGImage, quality: CGFloat = 0.72) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data, UTType.jpeg.identifier as CFString, 1, nil
        ) else { return nil }
        CGImageDestinationAddImage(
            destination,
            image,
            [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
        )
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }
}
