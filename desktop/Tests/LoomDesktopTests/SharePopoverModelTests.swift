import XCTest
@testable import LoomDesktopApp

final class SharePopoverModelTests: XCTestCase {
    func testLinkIsTheWebNoteURL() {
        let model = SharePopoverModel(apiBase: URL(string: "https://x.test")!, slug: "abc", ownerEmail: "me@x.test")
        XCTAssertEqual(model.link.absoluteString, "https://x.test/notes/abc")
        XCTAssertEqual(model.linkHost, "x.test")
        XCTAssertEqual(model.ownerInitial, "M")
    }
}
