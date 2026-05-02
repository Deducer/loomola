import XCTest
@testable import LoomDesktopApp

final class ObsidianExportWriterTests: XCTestCase {
    func testFrontmatterMeetingIdReadsQuotedId() {
        let markdown = """
        ---
        meeting_id: "media-123"
        title: "Weekly"
        ---

        # Weekly
        """

        XCTAssertEqual(ObsidianExportWriter.frontmatterMeetingId(in: markdown), "media-123")
    }

    func testFrontmatterMeetingIdIgnoresBodyContent() {
        let markdown = """
        # Notes

        meeting_id: "media-123"
        """

        XCTAssertNil(ObsidianExportWriter.frontmatterMeetingId(in: markdown))
    }

    func testExistingDestinationFindsMovedMarkdownFile() throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appending(path: "loom-obsidian-\(UUID().uuidString)")
        let nested = root.appending(path: "Archive")
        try fileManager.createDirectory(at: nested, withIntermediateDirectories: true)
        defer {
            try? fileManager.removeItem(at: root)
        }

        let movedFile = nested.appending(path: "renamed-meeting.md")
        try """
        ---
        meeting_id: "media-123"
        title: "Renamed"
        ---

        # Renamed
        """.write(to: movedFile, atomically: true, encoding: .utf8)

        let destination = ObsidianExportWriter.existingDestination(
            for: "media-123",
            in: root,
            fileManager: fileManager
        )

        XCTAssertEqual(destination?.standardizedFileURL.path, movedFile.standardizedFileURL.path)
    }
}
