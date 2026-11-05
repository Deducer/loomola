import XCTest
@testable import LoomDesktopApp

@MainActor
final class OrphanRetryCoordinatorTests: XCTestCase {
    private let stoppedAt = ISO8601DateFormatter().date(from: "2026-11-05T18:00:00Z")!

    func testPendingResumeFromBeforeTheOrphanStoppedIsStale() {
        let body: [String: Any] = [
            "error": "note_busy",
            "mediaStatus": "uploading",
            "resumeSegment": ["index": 2, "startedAt": "2026-11-05T17:40:00.000Z"],
        ]
        XCTAssertEqual(
            OrphanRetryCoordinator.staleResumeDecision(errorBody: body, orphanStoppedAt: stoppedAt),
            .abortAndRetry
        )
    }

    func testPendingResumeStartedLaterIsSomeoneElseRecording() {
        let body: [String: Any] = [
            "error": "note_busy",
            "mediaStatus": "uploading",
            "resumeSegment": ["index": 3, "startedAt": "2026-11-05T18:05:00Z"],
        ]
        XCTAssertEqual(
            OrphanRetryCoordinator.staleResumeDecision(errorBody: body, orphanStoppedAt: stoppedAt),
            .liveElsewhere
        )
    }

    func testBusyForAnotherReasonIsNotActedOn() {
        let transcribing: [String: Any] = ["error": "note_busy", "mediaStatus": "transcribing"]
        XCTAssertNil(OrphanRetryCoordinator.staleResumeDecision(errorBody: transcribing, orphanStoppedAt: stoppedAt))
        XCTAssertNil(OrphanRetryCoordinator.staleResumeDecision(errorBody: nil, orphanStoppedAt: stoppedAt))
        let malformed: [String: Any] = ["resumeSegment": ["startedAt": "yesterday"]]
        XCTAssertNil(OrphanRetryCoordinator.staleResumeDecision(errorBody: malformed, orphanStoppedAt: stoppedAt))
    }
}
