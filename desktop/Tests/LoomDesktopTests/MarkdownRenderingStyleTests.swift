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
            source.contains("style.paragraphSpacing = level == 1 ? 18 : 14"),
            "Heading spacing should preserve a readable gap before the following list."
        )
        XCTAssertFalse(
            source.contains("paragraphStyle.paragraphSpacing = 4"),
            "The old compact list spacing made generated notes feel crowded."
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
            source.contains("static let nestedListIndent: CGFloat = 32"),
            "Nested bullets should have enough indent to read as a separate hierarchy."
        )
    }

    private func markdownTextEditorSource() throws -> String {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let file = root.appending(path: "Sources/LoomDesktopApp/UI/Notes/MarkdownTextEditor.swift")
        return try String(contentsOf: file)
    }
}
