import SwiftUI
import XCTest
@testable import LoomDesktopApp

/// The tokenizer must hand the text view one drawn `#` marker per
/// heading line and one bullet per list item (parity rank 5).
final class MarkdownHeadingMarkerTests: XCTestCase {
    @MainActor
    func testTokenizerCollectsHeadingAndBulletMarkers() {
        let focus = FocusState<Bool>()
        let editor = MarkdownTextEditor(
            text: .constant(""),
            measuredHeight: .constant(0),
            placeholder: "",
            isFocused: focus.projectedValue
        )
        let coordinator = editor.makeCoordinator()
        let textView = MarkdownTextView()
        textView.string = "# Title\n\nBody line.\n\n## Section\n- one\n- two\n  - nested"
        coordinator.applyAttributes(to: textView)

        XCTAssertEqual(textView.renderedHeadingMarkerCount, 2)
        XCTAssertEqual(textView.renderedBulletMarkerCount, 3)
    }
}
