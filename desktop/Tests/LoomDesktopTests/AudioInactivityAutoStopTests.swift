import XCTest

final class AudioInactivityAutoStopTests: XCTestCase {
    func testAudioInactivityAutoStopIsWiredToAudioLevels() throws {
        let source = try recorderViewModelSource()

        XCTAssertTrue(
            source.contains("static let silenceInterval: TimeInterval = 15 * 60"),
            "Audio notes should auto-stop after 15 minutes of inactivity."
        )
        XCTAssertTrue(
            source.contains("recordAudioActivityIfNeeded(level: clampedLevel, at: now)"),
            "The inactivity timer should be driven by real capture levels."
        )
        XCTAssertTrue(
            source.contains("recordAudioBuffer(source: source)"),
            "The inactivity timer should also observe raw capture-buffer activity."
        )
        XCTAssertTrue(
            source.contains("audioInactivityHasSeenMeaningfulAudio"),
            "Startup silence should not stop a note before Loomola has heard meaningful audio."
        )
        XCTAssertTrue(
            source.contains("Audio capture stalled for 15 minutes. Finalizing audio note..."),
            "Capture-buffer stalls should finalize the note before the UI timer drifts for hours."
        )
        XCTAssertTrue(
            source.contains("statusMessage = \"No audio detected for 15 minutes. Finalizing audio note...\""),
            "Auto-stop should explain why the note is finalizing."
        )
        XCTAssertTrue(
            source.contains("cancelAudioInactivityMonitor()"),
            "The monitor must be cancelled when audio capture stops or is discarded."
        )
    }

    private func recorderViewModelSource() throws -> String {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let file = root.appending(path: "Sources/LoomDesktopApp/UI/RecorderViewModel.swift")
        return try String(contentsOf: file)
    }
}
