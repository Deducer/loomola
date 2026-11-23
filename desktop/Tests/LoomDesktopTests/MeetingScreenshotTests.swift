import CoreGraphics
import XCTest
@testable import LoomDesktopApp

final class MeetingWindowMatcherTests: XCTestCase {
    private func matches(_ app: String, _ title: String) -> Bool {
        MeetingWindowMatcher.isMeetingWindow(applicationName: app, title: title)
    }

    func testBrowserWindowMatchesOnlyWhileTheCallTabIsInFront() {
        XCTAssertTrue(matches("Google Chrome", "Meet - abc-defg-hij - Google Chrome"))
        XCTAssertTrue(matches("Arc", "Meet – Weekly sync"))
        XCTAssertTrue(matches("Safari", "Design review | Meeting | Microsoft Teams"))
        XCTAssertTrue(matches("Google Chrome", "Zoom Meeting - Google Chrome"))
        XCTAssertFalse(matches("Google Chrome", "Inbox (3) - ian@example.com - Gmail - Google Chrome"))
        XCTAssertFalse(matches("Google Chrome", "Meetings this week - Google Calendar - Google Chrome"))
    }

    func testNativeCallWindows() {
        XCTAssertTrue(matches("zoom.us", "Zoom Meeting"))
        XCTAssertTrue(matches("Microsoft Teams", "Weekly sync | Meeting | Microsoft Teams"))
        XCTAssertFalse(matches("zoom.us", "Zoom Workplace"))
        XCTAssertFalse(matches("zoom.us", "zoom floating video window"))
        XCTAssertFalse(matches("Notes", "Meeting notes"))
    }

    func testPicksTheLargestCallWindowAndIgnoresSmallOnes() {
        let windows = [
            MeetingWindowCandidate(id: 1, title: "Zoom Meeting", applicationName: "zoom.us",
                                   bounds: CGRect(x: 0, y: 0, width: 320, height: 180)),
            MeetingWindowCandidate(id: 2, title: "Zoom Meeting", applicationName: "zoom.us",
                                   bounds: CGRect(x: 0, y: 0, width: 1280, height: 720)),
            MeetingWindowCandidate(id: 3, title: "Budget.xlsx", applicationName: "Microsoft Excel",
                                   bounds: CGRect(x: 0, y: 0, width: 2560, height: 1440)),
        ]
        XCTAssertEqual(MeetingScreenshotCapturer.largestMeetingWindow(in: windows)?.id, 2)
        XCTAssertNil(MeetingScreenshotCapturer.largestMeetingWindow(in: [windows[0], windows[2]]))
    }
}

final class ScreenshotChangeDetectorTests: XCTestCase {
    private let cells = ScreenshotChangeDetector.gridWidth * ScreenshotChangeDetector.gridHeight

    /// A "slide": the first `fraction` of cells are ink, the rest paper.
    private func slide(_ fraction: Double) -> [UInt8] {
        let ink = Int(Double(cells) * fraction)
        return (0..<cells).map { $0 < ink ? 60 : 240 }
    }

    /// The same slide with a participant strip in the last 10% of cells that
    /// looks different in every frame.
    private func slide(_ fraction: Double, faces seed: Int) -> [UInt8] {
        var frame = slide(fraction)
        for index in (cells * 9 / 10)..<cells {
            frame[index] = UInt8((index * 31 + seed * 97) % 200)
        }
        return frame
    }

    /// One look at a screen that is holding still.
    private func look(_ detector: inout ScreenshotChangeDetector, at frame: [UInt8], time: TimeInterval) -> Bool {
        detector.consider(first: frame, second: frame, at: time).keep
    }

    func testKeepsTheFirstStillLook() {
        var detector = ScreenshotChangeDetector()
        XCTAssertTrue(look(&detector, at: slide(0.2), time: 6))
        XCTAssertEqual(detector.keptCount, 1)
    }

    func testDoesNotKeepTheSameViewTwice() {
        var detector = ScreenshotChangeDetector()
        XCTAssertTrue(look(&detector, at: slide(0.2), time: 6))
        XCTAssertFalse(look(&detector, at: slide(0.2), time: 60))
        XCTAssertFalse(look(&detector, at: slide(0.21), time: 120), "1% of cells is a cursor or a caret, not a new slide")
    }

    func testKeepsANewSlideInTheSameTemplate() {
        var detector = ScreenshotChangeDetector()
        XCTAssertTrue(look(&detector, at: slide(0.20), time: 6))
        XCTAssertTrue(look(&detector, at: slide(0.24), time: 30), "4% of cells is a text slide changing")
    }

    func testSkipsALookCaughtMidChangeAndKeepsTheNextOne() {
        var detector = ScreenshotChangeDetector()
        XCTAssertTrue(look(&detector, at: slide(0.2), time: 6))
        XCTAssertFalse(detector.consider(first: slide(0.2), second: slide(0.6), at: 30).keep, "the screen moved between the two frames")
        XCTAssertTrue(look(&detector, at: slide(0.6), time: 36))
    }

    func testFacesBesideTheSlideDoNotHideASlideChangeOrFakeOne() {
        var detector = ScreenshotChangeDetector()
        var kept: [Int] = []
        // Slide A for 8 looks, then slide B. The strip differs in every frame.
        for step in 0..<16 {
            let fraction = step < 8 ? 0.20 : 0.24
            let verdict = detector.consider(
                first: slide(fraction, faces: step * 2),
                second: slide(fraction, faces: step * 2 + 1),
                at: Double(step) * 30
            )
            if verdict.keep { kept.append(step) }
        }
        XCTAssertEqual(kept, [2, 8], "slide A once the strip is known to be restless, slide B at once, nothing for the strip")
    }

    func testAScrollingScreenIsNotKeptUntilItStops() {
        var detector = ScreenshotChangeDetector()
        XCTAssertTrue(look(&detector, at: slide(0.2), time: 0))
        var time = 30.0
        for step in 0..<6 {
            let verdict = detector.consider(
                first: slide(0.2 + Double(step) * 0.1),
                second: slide(0.35 + Double(step) * 0.1),
                at: time
            )
            XCTAssertFalse(verdict.keep, "scrolling at look \(step)")
            time += 6
        }
        XCTAssertTrue(look(&detector, at: slide(0.9), time: time), "kept on the first look after it stops, restless or not")
    }

    func testSpacesKeptFramesApartAndWidensTheGap() {
        var detector = ScreenshotChangeDetector()
        XCTAssertTrue(look(&detector, at: slide(0.2), time: 0))
        XCTAssertFalse(look(&detector, at: slide(0.6), time: 6), "under 12 s since the last kept frame")
        XCTAssertTrue(look(&detector, at: slide(0.6), time: 12))
        XCTAssertEqual(detector.minimumGap, 12)
        var time = 12.0
        for index in 0..<8 {
            time += 12
            XCTAssertTrue(look(&detector, at: slide(index.isMultiple(of: 2) ? 0.2 : 0.6), time: time))
        }
        XCTAssertEqual(detector.keptCount, 10)
        XCTAssertEqual(detector.minimumGap, 30, "after ten frames the spacing widens")
    }

    func testSkipsBlankFrames() {
        var detector = ScreenshotChangeDetector()
        XCTAssertFalse(look(&detector, at: [UInt8](repeating: 0, count: cells), time: 6))
    }

    func testARejectedFrameDoesNotCountAndStartsACooldown() {
        var detector = ScreenshotChangeDetector()
        XCTAssertTrue(look(&detector, at: slide(0.2), time: 6))
        detector.lastKeepWasRejected(at: 6)
        XCTAssertEqual(detector.keptCount, 0)
        XCTAssertEqual(detector.attemptCount, 1)
        XCTAssertFalse(look(&detector, at: slide(0.6), time: 30), "inside the 30 s cooldown")
        XCTAssertFalse(look(&detector, at: slide(0.2), time: 40), "the rejected view is still the comparison point")
        XCTAssertTrue(look(&detector, at: slide(0.6), time: 42))
    }

    func testAFailedUploadIsRetriedOnTheNextLook() {
        var detector = ScreenshotChangeDetector()
        XCTAssertTrue(look(&detector, at: slide(0.2), time: 6))
        detector.lastKeepFailed()
        XCTAssertTrue(look(&detector, at: slide(0.2), time: 12))
    }

    func testStopsAtTheKeepLimit() {
        var detector = ScreenshotChangeDetector()
        detector.keepLimit = 2
        for index in 0..<6 {
            _ = look(&detector, at: slide(index.isMultiple(of: 2) ? 0.2 : 0.6), time: Double(index) * 20)
        }
        XCTAssertEqual(detector.keptCount, 2)
        XCTAssertTrue(detector.isExhausted)
    }
}

final class MeetingScreenshotPlumbingTests: XCTestCase {
    func testMultipartBodyCarriesKindOffsetAndTheImage() throws {
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xD9])
        let body = BackendClient.screenshotMultipartBody(boundary: "B", jpeg: jpeg, offsetMs: 754_000)
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("name=\"kind\"\r\n\r\nscreenshot\r\n"))
        XCTAssertTrue(text.contains("name=\"offsetMs\"\r\n\r\n754000\r\n"))
        XCTAssertTrue(text.contains("name=\"file\"; filename=\"meeting-screenshot.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n"))
        XCTAssertNotNil(body.range(of: jpeg))
        XCTAssertTrue(text.hasSuffix("\r\n--B--\r\n"))
    }

    func testAttachmentDecodesWithAndWithoutScreenshotFields() throws {
        let old = #"{"id":"a","filename":"f.png","contentType":"image/png","byteSize":3,"createdAt":"x","url":"u"}"#
        let new = #"{"id":"b","kind":"screenshot","offsetMs":3729000,"description":"Slide","filename":"s.jpg","contentType":"image/jpeg","byteSize":3,"createdAt":"x","url":"u"}"#
        let image = try JSONDecoder().decode(NoteAttachmentDTO.self, from: Data(old.utf8))
        XCTAssertFalse(image.isMeetingScreenshot)
        XCTAssertNil(image.offsetLabel)
        let screenshot = try JSONDecoder().decode(NoteAttachmentDTO.self, from: Data(new.utf8))
        XCTAssertTrue(screenshot.isMeetingScreenshot)
        XCTAssertEqual(screenshot.offsetLabel, "1:02:09")
    }

    func testSkippedScreenshotDecodesToNil() throws {
        let skipped = #"{"attachment":null,"skipped":"no_shared_content"}"#
        XCTAssertNil(try JSONDecoder().decode(CreateScreenshotResponse.self, from: Data(skipped.utf8)).attachment)
    }

    /// Live round trip through the real server. Skipped unless pointed at a
    /// note: LOOM_SCREENSHOT_LIVE_NOTE_ID, LOOM_SCREENSHOT_LIVE_TOKEN (a desktop
    /// access token) and LOOM_SCREENSHOT_LIVE_JPEG (a file path).
    func testLiveUploadRoundTrip() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let noteId = env["LOOM_SCREENSHOT_LIVE_NOTE_ID"],
              let token = env["LOOM_SCREENSHOT_LIVE_TOKEN"],
              let jpegPath = env["LOOM_SCREENSHOT_LIVE_JPEG"]
        else { throw XCTSkip("no live note configured") }
        let base = URL(string: env["LOOM_API_BASE_URL"] ?? "https://loom.dissonance.cloud")!
        let backend = BackendClient(baseURL: base) { token }
        let jpeg = try Data(contentsOf: URL(fileURLWithPath: jpegPath))

        let stored = try await backend.uploadNoteScreenshot(mediaId: noteId, jpeg: jpeg, offsetMs: 61_000)
        let attachment = try XCTUnwrap(stored, "the server dropped the frame as no shared content")
        XCTAssertTrue(attachment.isMeetingScreenshot)
        XCTAssertEqual(attachment.offsetLabel, "1:01")
        print("live description:", attachment.description ?? "<none>")

        let listed = try await backend.listNoteAttachments(mediaId: noteId)
        XCTAssertTrue(listed.contains { $0.id == attachment.id && $0.offsetMs == 61_000 })
    }

    func testFittedSizeCapsTheLongSideAndKeepsTheShape() {
        let fitted = MeetingScreenshotCapturer.fittedSize(width: 3200, height: 1800, maxLongSide: 1600)
        XCTAssertEqual(fitted, CGSize(width: 1600, height: 900))
        XCTAssertEqual(
            MeetingScreenshotCapturer.fittedSize(width: 1280, height: 720, maxLongSide: 1600),
            CGSize(width: 1280, height: 720)
        )
    }

    func testSignatureIsStableForTheSameImageAndDiffersForADifferentOne() throws {
        func image(split: CGFloat) throws -> CGImage {
            let context = try XCTUnwrap(CGContext(
                data: nil, width: 640, height: 360, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ))
            context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: 640, height: 360))
            context.setFillColor(CGColor(red: 0.1, green: 0.1, blue: 0.1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: 640 * split, height: 360))
            return try XCTUnwrap(context.makeImage())
        }
        let a = MeetingScreenshotCapturer.signature(of: try image(split: 0.3))
        let again = MeetingScreenshotCapturer.signature(of: try image(split: 0.3))
        let b = MeetingScreenshotCapturer.signature(of: try image(split: 0.8))
        XCTAssertEqual(a.count, ScreenshotChangeDetector.gridWidth * ScreenshotChangeDetector.gridHeight)
        XCTAssertEqual(ScreenshotChangeDetector.fractionChanged(a, again, tolerance: 10), 0)
        XCTAssertEqual(ScreenshotChangeDetector.fractionChanged(a, b, tolerance: 10), 0.5, accuracy: 0.05)
        XCTAssertNotNil(MeetingScreenshotCapturer.jpegData(from: try image(split: 0.3)))
    }
}
