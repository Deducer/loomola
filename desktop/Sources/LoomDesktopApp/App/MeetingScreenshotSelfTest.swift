import CoreGraphics
import Foundation

/// `Loomola --meeting-screenshot-selftest <dir> [seconds]`
///
/// Runs the real meeting-screenshot capturer against whatever windows are on
/// screen and writes the kept frames plus `report.json` to `<dir>` instead of
/// uploading. It exits before the app itself starts: no window, no sign-in,
/// no recording, nothing sent anywhere.
///
/// It exists because Screen Recording permission belongs to the installed
/// app, so the capture path can only be checked from inside it:
///
///     open -n -a /Applications/Loomola.app --args --meeting-screenshot-selftest /tmp/shots 60
enum MeetingScreenshotSelfTest {
    static let flag = "--meeting-screenshot-selftest"

    /// Returns normally when the flag is absent. Otherwise never returns.
    static func runAndExitIfRequested(arguments: [String] = CommandLine.arguments) {
        guard let index = arguments.firstIndex(of: flag), arguments.count > index + 1 else { return }
        let directory = URL(fileURLWithPath: arguments[index + 1], isDirectory: true)
        let seconds = arguments.count > index + 2 ? TimeInterval(arguments[index + 2]) ?? 30 : 30
        Task.detached {
            await run(directory: directory, seconds: seconds)
            exit(0)
        }
        dispatchMain()
    }

    private struct Report: Encodable {
        struct Sample: Encodable {
            let seconds: Double
            let window: String?
            let moved: Double?
            let slideChange: Double?
            let screenChange: Double?
            let kept: Bool
        }
        struct Kept: Encodable {
            let file: String
            let offsetMs: Int
            let window: String
            let width: Int
            let height: Int
            let bytes: Int
        }
        var screenRecordingPermission: Bool
        var meetingWindowsAtStart: [String]
        var samples: [Sample] = []
        var kept: [Kept] = []
    }

    private final class ReportBox: @unchecked Sendable {
        private let lock = NSLock()
        private var report: Report
        init(_ report: Report) { self.report = report }
        func update(_ change: (inout Report) -> Void) {
            lock.lock()
            defer { lock.unlock() }
            change(&report)
        }
        var value: Report {
            lock.lock()
            defer { lock.unlock() }
            return report
        }
    }

    private static func run(directory: URL, seconds: TimeInterval) async {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let box = ReportBox(Report(
            screenRecordingPermission: CGPreflightScreenCaptureAccess(),
            meetingWindowsAtStart: []
        ))
        defer { write(box.value, to: directory) }
        guard #available(macOS 14.0, *) else { return }

        box.update { report in
            report.meetingWindowsAtStart = MeetingScreenshotCapturer.onScreenWindows()
                .filter { MeetingWindowMatcher.isMeetingWindow(applicationName: $0.applicationName, title: $0.title) }
                .map { "\($0.applicationName): \($0.title) (\(Int($0.bounds.width))x\(Int($0.bounds.height)))" }
        }

        let startedAt = Date()
        let capturer = MeetingScreenshotCapturer(
            clock: { .recording(seconds: Date().timeIntervalSince(startedAt)) },
            upload: { shot in
                let name = String(format: "shot-%06d.jpg", shot.offsetMs)
                do {
                    try shot.jpeg.write(to: directory.appendingPathComponent(name))
                } catch {
                    return .failed
                }
                box.update { report in
                    report.kept.append(Report.Kept(
                        file: name, offsetMs: shot.offsetMs, window: shot.windowTitle,
                        width: shot.pixelWidth, height: shot.pixelHeight, bytes: shot.jpeg.count
                    ))
                }
                return .stored
            },
            onSample: { sample in
                box.update { report in
                    report.samples.append(Report.Sample(
                        seconds: (sample.seconds * 10).rounded() / 10,
                        window: sample.windowTitle,
                        moved: sample.verdict.movedWithinPair,
                        slideChange: sample.verdict.slideChange,
                        screenChange: sample.verdict.screenChange,
                        kept: sample.verdict.keep
                    ))
                }
            }
        )
        capturer.start()
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        capturer.stop()
    }

    private static func write(_ report: Report, to directory: URL) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(report) else { return }
        try? data.write(to: directory.appendingPathComponent("report.json"))
    }
}
