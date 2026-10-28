import XCTest
@testable import LoomDesktopApp

final class SpeakerLabelPresentationTests: XCTestCase {
    private func assignment(needsReview: Bool?, dismissed: Bool = false, suggestion: Bool = false) -> SpeakerAssignmentDTO {
        SpeakerAssignmentDTO(
            speakerIdx: 0,
            personId: "p",
            displayLabelOverride: nil,
            isSuggestion: suggestion,
            dismissedAt: dismissed ? "2026-10-27T00:00:00Z" : nil,
            suggestionConfidence: nil,
            suggestionEvidence: nil,
            autoApplied: nil,
            needsReview: needsReview
        )
    }

    func testNeedsReviewNameIsVisiblyUncertain() {
        let p = SpeakerLabelPresentation.make(name: "Ian Cross", assignment: assignment(needsReview: true))
        XCTAssertEqual(p, SpeakerLabelPresentation(text: "Ian Cross?", isUncertain: true))
    }

    func testConfirmedAndOlderServerNamesAreUnchanged() {
        XCTAssertEqual(
            SpeakerLabelPresentation.make(name: "Ian Cross", assignment: assignment(needsReview: false)),
            SpeakerLabelPresentation(text: "Ian Cross", isUncertain: false)
        )
        XCTAssertEqual(
            SpeakerLabelPresentation.make(name: "Speaker 2", assignment: nil),
            SpeakerLabelPresentation(text: "Speaker 2", isUncertain: false)
        )
        XCTAssertFalse(
            SpeakerLabelPresentation.make(name: "X", assignment: assignment(needsReview: nil)).isUncertain
        )
    }

    func testPendingSuggestionNameIsVisiblyUncertain() {
        let p = SpeakerLabelPresentation.make(name: "Sarah", assignment: assignment(needsReview: false, suggestion: true))
        XCTAssertEqual(p, SpeakerLabelPresentation(text: "Sarah?", isUncertain: true))
        XCTAssertFalse(
            SpeakerLabelPresentation.make(name: "Sarah", assignment: assignment(needsReview: nil, dismissed: true, suggestion: true)).isUncertain
        )
    }

    func testDecodesNeedsReviewFromServerJSON() throws {
        let json = #"{"speakerIdx":1,"personId":"p","displayLabelOverride":null,"isSuggestion":false,"dismissedAt":null,"needsReview":true,"autoApplied":false}"#
        let dto = try JSONDecoder().decode(SpeakerAssignmentDTO.self, from: Data(json.utf8))
        XCTAssertTrue(SpeakerLabelPresentation.make(name: "Sarah", assignment: dto).isUncertain)
    }
}
