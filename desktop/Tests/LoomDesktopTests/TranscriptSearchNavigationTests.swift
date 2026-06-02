import XCTest

final class TranscriptSearchNavigationTests: XCTestCase {
    func testTranscriptSearchTracksIndividualMatchesAndNavigation() throws {
        let source = try noteWorkspaceSource()

        XCTAssertTrue(
            source.contains("private struct TranscriptSearchMatch"),
            "Transcript search should model individual matches, not just matching bubbles."
        )
        XCTAssertTrue(
            source.contains("@State private var activeTranscriptSearchIndex"),
            "Transcript search should track the active match for previous/next navigation."
        )
        XCTAssertTrue(
            source.contains("moveTranscriptSearchSelection(delta: 1"),
            "Transcript search should expose next-match navigation."
        )
        XCTAssertTrue(
            source.contains("moveTranscriptSearchSelection(delta: -1"),
            "Transcript search should expose previous-match navigation."
        )
        XCTAssertTrue(
            source.contains("proxy.scrollTo(transcriptBubbleScrollId"),
            "Transcript search should scroll the active match into view."
        )
    }

    func testTranscriptSearchHighlightsAllOccurrences() throws {
        let source = try noteWorkspaceSource()

        XCTAssertTrue(
            source.contains("localizedCaseInsensitiveRanges(of: query)"),
            "Transcript search should find every occurrence of the query."
        )
        XCTAssertTrue(
            source.contains("attributed[lower..<upper].backgroundColor"),
            "Transcript search should visually highlight matching text ranges."
        )
        XCTAssertTrue(
            source.contains("Color.orange.opacity(0.95)"),
            "Transcript search should distinguish the active match from passive matches."
        )
    }

    private func noteWorkspaceSource() throws -> String {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let file = root.appending(path: "Sources/LoomDesktopApp/UI/Notes/NoteWorkspaceView.swift")
        return try String(contentsOf: file)
    }
}
