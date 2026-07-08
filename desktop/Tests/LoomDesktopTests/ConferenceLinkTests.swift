import XCTest
@testable import LoomDesktopApp

final class ConferenceLinkTests: XCTestCase {
    func testExtractsZoomJoinLinkFromNotes() {
        let notes = """
        Ian Cross is inviting you to a scheduled Zoom meeting.
        Join Zoom Meeting
        https://us02web.zoom.us/j/89012345678?pwd=abcDEF123
        Meeting ID: 890 1234 5678
        """
        XCTAssertEqual(
            ConferenceLink.extract(from: notes)?.absoluteString,
            "https://us02web.zoom.us/j/89012345678?pwd=abcDEF123"
        )
    }

    func testPrefersJoinLinkOverSupportLink() {
        let notes = """
        Having trouble? https://zoom.us/download
        Join: https://zoom.us/j/123456789
        """
        XCTAssertEqual(
            ConferenceLink.extract(from: notes)?.absoluteString,
            "https://zoom.us/j/123456789"
        )
    }

    func testExtractsGoogleMeetFromLocation() {
        XCTAssertEqual(
            ConferenceLink.extract(from: "Room 4 / https://meet.google.com/abc-defg-hij")?.absoluteString,
            "https://meet.google.com/abc-defg-hij"
        )
    }

    func testExtractsTeamsMeetupJoin() {
        let text = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_xyz%40thread.v2/0?context=%7b%7d"
        XCTAssertEqual(ConferenceLink.extract(from: text)?.host, "teams.microsoft.com")
    }

    func testExtractsFaceTimeLink() {
        XCTAssertEqual(
            ConferenceLink.extract(from: "join me: https://facetime.apple.com/join#v=1&p=abc&k=def")?.host,
            "facetime.apple.com"
        )
    }

    func testTrimsTrailingProsePunctuation() {
        XCTAssertEqual(
            ConferenceLink.extract(from: "Join at https://zoom.us/j/555.")?.absoluteString,
            "https://zoom.us/j/555"
        )
    }

    func testReturnsNilForPlainText() {
        XCTAssertNil(ConferenceLink.extract(from: "Quarterly planning — bring your OKRs"))
        XCTAssertNil(ConferenceLink.extract(from: ""))
    }
}
