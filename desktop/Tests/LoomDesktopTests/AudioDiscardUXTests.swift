import XCTest

final class AudioDiscardUXTests: XCTestCase {
    func testHomeBannerExposesConfirmedDiscard() throws {
        let source = try source(at: "Sources/LoomDesktopApp/UI/Home/IdleHomeView.swift")

        XCTAssertTrue(
            source.contains("SecondaryButton(\"Discard\", icon: \"trash\")"),
            "The active audio card should expose Discard without making the user open the note."
        )
        assertConfirmedDiscard(in: source)
    }

    func testWorkspaceMenuAlsoRequiresConfirmation() throws {
        let source = try source(at: "Sources/LoomDesktopApp/UI/Notes/NoteWorkspaceView.swift")

        XCTAssertTrue(
            source.contains("menuItem(label: \"Discard audio note\", icon: \"trash\""),
            "The workspace menu should name the destructive action consistently."
        )
        XCTAssertTrue(
            source.contains("showDiscardAudioConfirmation = true"),
            "The workspace menu should open the confirmation instead of discarding immediately."
        )
        assertConfirmedDiscard(in: source)
    }

    func testDiscardUsesDedicatedNonUploadState() throws {
        let model = try source(at: "Sources/LoomDesktopApp/UI/RecorderViewModel.swift")
        let discardStart = try XCTUnwrap(model.range(of: "private func discardAudioNoteRecording() async"))
        let discardEnd = try XCTUnwrap(
            model.range(of: "// MARK: - Orphan recovery", range: discardStart.upperBound..<model.endIndex)
        )
        let discard = String(model[discardStart.lowerBound..<discardEnd.lowerBound])

        XCTAssertTrue(discard.contains("isDiscardingAudioNote = true"))
        XCTAssertFalse(discard.contains("state = .finalizing"))
        XCTAssertTrue(discard.contains("state = .signedInIdle"))

        let home = try source(at: "Sources/LoomDesktopApp/UI/Home/IdleHomeView.swift")
        XCTAssertTrue(home.contains("Discarding audio note…"))
        XCTAssertTrue(home.contains("Deleting local audio…"))
    }

    func testNewAudioNoteStartsFromFreshDraftState() throws {
        let model = try source(at: "Sources/LoomDesktopApp/UI/RecorderViewModel.swift")
        let start = try XCTUnwrap(model.range(of: "private func startAudioNoteRecordingAfterReadiness()"))
        let titleRead = try XCTUnwrap(
            model.range(of: "let trimmedTitle = audioTitle", range: start.upperBound..<model.endIndex)
        )
        let prefix = String(model[start.lowerBound..<titleRead.lowerBound])

        XCTAssertTrue(prefix.contains("prepareForFreshAudioNote()"))
        XCTAssertTrue(model.contains("liveNotesBody = \"\""))
        XCTAssertTrue(model.contains("audioTitle = \"\""))
        XCTAssertTrue(model.contains("liveTranscription.reset()"))
    }

    func testLateGeneratedResultCannotCrossNoteBoundary() throws {
        let model = try source(at: "Sources/LoomDesktopApp/UI/RecorderViewModel.swift")
        XCTAssertTrue(model.contains("func applyGeneratedAudioNote(mediaId: String"))
        XCTAssertTrue(model.contains("activeAudioRecordingId == mediaId"))

        let main = try source(at: "Sources/LoomDesktopApp/UI/MainRecorderView.swift")
        XCTAssertTrue(main.contains(".id(noteWorkspaceIdentity(for: target))"))

        let workspace = try source(at: "Sources/LoomDesktopApp/UI/Notes/NoteWorkspaceView.swift")
        XCTAssertTrue(workspace.contains("workspaceMatches(mediaId: mediaId"))
        XCTAssertTrue(workspace.contains("viewModel.applyGeneratedAudioNote(\n                mediaId: mediaId"))
    }

    private func assertConfirmedDiscard(in source: String) {
        XCTAssertTrue(source.contains(".alert(\"Discard this audio note?\""))
        XCTAssertTrue(source.contains("Button(\"Discard\", role: .destructive)"))
        XCTAssertTrue(source.contains("The audio can’t be recovered."))
        XCTAssertTrue(source.contains("viewModel.cancelAudioNoteRecording()"))
    }

    private func source(at relativePath: String) throws -> String {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        return try String(contentsOf: root.appending(path: relativePath))
    }
}
