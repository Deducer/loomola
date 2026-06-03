import XCTest

final class FinalizingHomeCopyTests: XCTestCase {
    func testFinalizingHomeCopyIsMediaAware() throws {
        let source = try finalizingHomeSource()

        XCTAssertTrue(
            source.contains("Finalizing audio note"),
            "Audio-only uploads should not inherit the Loom video finalizing headline."
        )
        XCTAssertTrue(
            source.contains("Uploading audio note"),
            "Audio-only uploads should use audio-note upload copy."
        )
        XCTAssertTrue(
            source.contains("Uploading video"),
            "Video uploads should keep explicit video copy."
        )
        XCTAssertTrue(
            source.contains("Long audio notes can take a few minutes."),
            "Audio upload subcopy should name audio notes instead of recordings."
        )
        XCTAssertFalse(
            source.contains("return progress >= 0.89 ? \"Processing recording\" : \"Uploading video\""),
            "FinalizingHomeView should no longer hard-code video copy for every upload."
        )
    }

    func testRecorderKeepsUploadKindAfterLeavingRecordingSurface() throws {
        let source = try recorderViewModelSource()

        XCTAssertTrue(
            source.contains("@Published private(set) var finalizingRecordingKind"),
            "RecorderViewModel should preserve the media kind for the shared finalizing/upload screen."
        )
        XCTAssertTrue(
            source.contains("finalizingRecordingKind = .video\n        activeRecordingKind = nil"),
            "Video stop should tag the upload as video before clearing activeRecordingKind."
        )
        XCTAssertTrue(
            source.contains("finalizingRecordingKind = .audio\n        activeRecordingKind = nil"),
            "Audio stop should tag the upload as audio before clearing activeRecordingKind."
        )
        XCTAssertTrue(
            source.contains("statusMessage = \"Uploading audio note...\""),
            "Audio uploads should not keep stale finalizing copy once the upload begins."
        )
    }

    private func finalizingHomeSource() throws -> String {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let file = root.appending(path: "Sources/LoomDesktopApp/UI/Home/FinalizingHomeView.swift")
        return try String(contentsOf: file)
    }

    private func recorderViewModelSource() throws -> String {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let file = root.appending(path: "Sources/LoomDesktopApp/UI/RecorderViewModel.swift")
        return try String(contentsOf: file)
    }
}
