import XCTest

final class NoteWorkspaceEnhancementTests: XCTestCase {
    func testDesktopReviewKeepsRawAndEnhancedNotesSeparate() throws {
        let source = try noteWorkspaceSource()

        // Granola's "My notes / Enhanced" split: generated notes live in
        // their own read-only pane and default to shown when present;
        // the user's raw notes are never overwritten by generation
        // (the old merge-into-one-editor behavior destroyed raw notes
        // on the next autosave).
        XCTAssertTrue(
            source.contains("enhancedBody = generatedBody ?? \"\""),
            "Generated notes should hydrate the enhanced pane, not the raw editor."
        )
        XCTAssertTrue(
            source.contains("showEnhanced = !(generatedBody ?? \"\").isEmpty"),
            "Review mode should default to the Enhanced pane when generated notes exist."
        )
        XCTAssertTrue(
            source.contains("reviewLastSaved = savedBody"),
            "Autosave must track the RAW body — tracking generated content overwrote raw notes."
        )
        XCTAssertFalse(
            source.contains("let displayBody = generatedBody ?? savedBody"),
            "The merged single-editor behavior should be gone."
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

    func testDesktopReviewShowsTimestampedActionItems() throws {
        let source = try noteWorkspaceSource()

        XCTAssertTrue(
            source.contains("reviewActionItems = enhancement.actionItems ?? []"),
            "Review mode should hydrate action items from the enhancement endpoint."
        )
        XCTAssertTrue(
            source.contains("viewModel.openWebNote(slug: recording.slug, timestampSec: timestampSec)"),
            "Desktop action-item rows should open the web player at the source timestamp."
        )
    }

    private func noteWorkspaceSource() throws -> String {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let file = root.appending(path: "Sources/LoomDesktopApp/UI/Notes/NoteWorkspaceView.swift")
        return try String(contentsOf: file)
    }
}
