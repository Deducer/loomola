import XCTest
@testable import LoomDesktopApp

final class MarkdownDisplayNormalizerTests: XCTestCase {
    func testNormalizesGeneratedTaskTableIntoBullets() {
        let markdown = """
        # Next Week

        | Task | Owner | Notes |
        |---|---|---|
        | Retry first sequence shot | Omar | Report back Monday |
        | Check timeline | Ian/Jeremy | Sarah traveling overseas |
        """

        let normalized = MarkdownDisplayNormalizer.normalizeGeneratedNotes(markdown)

        XCTAssertFalse(normalized.contains("| Task | Owner | Notes |"))
        XCTAssertFalse(normalized.contains("|---|---|---|"))
        XCTAssertTrue(normalized.contains("- **Retry first sequence shot** (Omar): Report back Monday"))
        XCTAssertTrue(normalized.contains("- **Check timeline** (Ian/Jeremy): Sarah traveling overseas"))
    }

    func testRemovesGeneratedHorizontalRulesAndCollapsesDoubledBold() {
        let markdown = """
        ****Highlights****

        ---

        - ****Reviewer notes**** arrived.
        """

        let normalized = MarkdownDisplayNormalizer.normalizeGeneratedNotes(markdown)

        XCTAssertFalse(normalized.contains("---"))
        XCTAssertFalse(normalized.contains("****"))
        XCTAssertTrue(normalized.contains("**Highlights**"))
        XCTAssertTrue(normalized.contains("- **Reviewer notes** arrived."))
    }

    func testCollapsesDoubledBoldWhenInnerTextContainsMarkdown() {
        let markdown = #"****Key finding: using the **`@mention`** syntax helps.****"#

        let normalized = MarkdownDisplayNormalizer.normalizeGeneratedNotes(markdown)

        XCTAssertFalse(normalized.hasPrefix("****"))
        XCTAssertFalse(normalized.hasSuffix("****"))
        XCTAssertTrue(normalized.hasPrefix("**Key finding:"))
        XCTAssertTrue(normalized.hasSuffix("helps.**"))
    }
}
