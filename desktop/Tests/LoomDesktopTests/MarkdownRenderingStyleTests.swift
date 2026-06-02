import XCTest

final class MarkdownRenderingStyleTests: XCTestCase {
    func testDesktopMarkdownRendererKeepsGranolaLikeSpacing() throws {
        let source = try markdownTextEditorSource()

        XCTAssertTrue(
            source.contains("bodyParagraphStyle()"),
            "Desktop markdown should apply a base paragraph style instead of relying on NSTextView defaults."
        )
        XCTAssertTrue(
            source.contains("headingParagraphStyle("),
            "Desktop headings need explicit bottom spacing so the first bullet is not cramped."
        )
        XCTAssertTrue(
            source.contains("style.paragraphSpacing = level == 1 ? 10 : 8"),
            "Heading spacing should let the renderer supply the gap without doubling generated blank lines."
        )
        XCTAssertFalse(
            source.contains("paragraphStyle.paragraphSpacing = 4"),
            "The old compact list spacing made generated notes feel crowded."
        )
        XCTAssertTrue(
            source.contains("static let bodyLineSpacing: CGFloat = 5.5"),
            "Body copy should use explicit line spacing for a calmer meeting-note reading rhythm."
        )
    }

    func testDesktopMarkdownRendererDistinguishesNestedBullets() throws {
        let source = try markdownTextEditorSource()

        XCTAssertTrue(
            source.contains("RenderedBulletKind"),
            "Nested list levels should carry a visual bullet kind."
        )
        XCTAssertTrue(
            source.contains("kind: nestingLevel == 0 ? .filled : .hollow"),
            "Nested bullets should render as hollow markers instead of matching top-level bullets."
        )
        XCTAssertTrue(
            source.contains("static let nestedListIndent: CGFloat = 24"),
            "Nested bullets should indent clearly without pushing note text too far right."
        )
        XCTAssertTrue(
            source.contains("static let listTextIndent: CGFloat = 28"),
            "Top-level bullets should have compact Granola-like text alignment."
        )
    }

    private func markdownTextEditorSource() throws -> String {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let file = root.appending(path: "Sources/LoomDesktopApp/UI/Notes/MarkdownTextEditor.swift")
        return try String(contentsOf: file)
    }
}
