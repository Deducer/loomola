import XCTest
@testable import LoomDesktopApp

/// Locks the URL-construction fix from the c470373 regression. The
/// previous implementation used `baseURL.appending(path: path)`,
/// which percent-encodes `?` — `/foo?x=1` became `/foo%3Fx=1` and
/// the server routed it to `/foo` with no query (or 404). The
/// desktop's Recent strip silently showed the empty state forever.
final class BackendURLBuilderTests: XCTestCase {
    private let base = URL(string: "https://loom.dissonance.cloud")!

    func testPathWithoutQueryIsAppendedCleanly() {
        let url = BackendURLBuilder.makeURL(path: "/api/recordings/recent", baseURL: base)
        XCTAssertEqual(url.absoluteString, "https://loom.dissonance.cloud/api/recordings/recent")
    }

    func testPathWithQueryPreservesQuestionMark() {
        // The original bug: `?` was percent-encoded to `%3F`.
        let url = BackendURLBuilder.makeURL(path: "/api/recordings/recent?limit=4", baseURL: base)
        XCTAssertEqual(url.absoluteString, "https://loom.dissonance.cloud/api/recordings/recent?limit=4")
        XCTAssertFalse(url.absoluteString.contains("%3F"), "question mark must not be percent-encoded")
        XCTAssertEqual(url.query, "limit=4")
    }

    func testPathWithMultipleQueryParamsIsPreserved() {
        let url = BackendURLBuilder.makeURL(path: "/api/foo?a=1&b=2", baseURL: base)
        XCTAssertEqual(url.query, "a=1&b=2")
    }

    func testPathWithSpecialCharactersInIdSegment() {
        // UUIDs with dashes and the export.md suffix — common shape
        // for /api/notes/<uuid>/export.md and similar.
        let url = BackendURLBuilder.makeURL(
            path: "/api/notes/9f617d89-44b1-4388-a78b-feb1f4afddeb/export.md",
            baseURL: base
        )
        XCTAssertEqual(
            url.absoluteString,
            "https://loom.dissonance.cloud/api/notes/9f617d89-44b1-4388-a78b-feb1f4afddeb/export.md"
        )
    }
}
