import XCTest

final class NoteWorkspaceEnhancementTests: XCTestCase {
    func testDesktopReviewPrefersGeneratedNotesWhenAvailable() throws {
        let source = try noteWorkspaceSource()

        XCTAssertTrue(
            source.contains("let displayBody = generatedBody ?? savedBody"),
            "Review mode should mirror web by showing generated notes when ai_outputs.summary exists."
        )
        XCTAssertFalse(
            source.contains("} else {\n                                displayBody = savedBody\n                            }"),
            "Review mode should not hide generated notes merely because the raw note body is non-empty."
        )
    }

    func testDesktopKeepsWatchingPendingEnhancementRuns() throws {
        let source = try noteWorkspaceSource()

        XCTAssertTrue(
            source.contains("beginPollingEnhancement("),
            "Opening a note with an already-pending AI run should resume desktop polling."
        )
        XCTAssertTrue(
            source.contains("while !Task.isCancelled"),
            "The desktop poller should stay attached while the workspace is open instead of timing out early."
        )
        XCTAssertFalse(
            source.contains("Date().addingTimeInterval(60)"),
            "A one-minute polling deadline is too short for longer calls and causes web/desktop divergence."
        )
        XCTAssertFalse(
            source.contains("Still running — check back shortly"),
            "Desktop should keep watching a running job rather than telling the user to check elsewhere."
        )
    }

    func testTranscriptLoadClearsStaleWaitingState() throws {
        let source = try noteWorkspaceSource()

        XCTAssertTrue(
            source.contains("clearTranscriptWaitingStateIfReady(response)"),
            "A transcript arriving after the desktop entered Waiting for transcript should restore Generate notes."
        )
        XCTAssertTrue(
            source.contains("enhanceStatus = .idle"),
            "The stale waiting state should clear back to the idle Generate notes state."
        )
    }

    private func noteWorkspaceSource() throws -> String {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let file = root.appending(path: "Sources/LoomDesktopApp/UI/Notes/NoteWorkspaceView.swift")
        return try String(contentsOf: file)
    }
}
