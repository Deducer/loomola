import XCTest
@testable import LoomDesktopApp

final class EnhanceTriggerTests: XCTestCase {
    func testFreshStopWithLiveTranscriptGeneratesImmediately() {
        XCTAssertEqual(
            EnhanceTrigger.decision(transcriptReady: true, transcriptTextLength: 120, mediaStatus: "uploading", generationStatus: "idle", justStopped: true),
            .generateNow
        )
    }

    func testReopenedNoteWithTranscriptWaitsForAClick() {
        XCTAssertEqual(
            EnhanceTrigger.decision(transcriptReady: true, transcriptTextLength: 120, mediaStatus: "ready", generationStatus: "complete", justStopped: false),
            .showGenerate
        )
    }

    func testRunningGenerationJustPolls() {
        XCTAssertEqual(
            EnhanceTrigger.decision(transcriptReady: true, transcriptTextLength: 120, mediaStatus: "transcribing", generationStatus: "pending", justStopped: true),
            .inProgress
        )
    }

    func testNoTextYetWaitsForTheTranscript() {
        XCTAssertEqual(
            EnhanceTrigger.decision(transcriptReady: false, transcriptTextLength: nil, mediaStatus: "transcribing", generationStatus: nil, justStopped: true),
            .waitForTranscript
        )
    }

    func testEmptyFinishedTranscriptHasNothingToGenerate() {
        XCTAssertEqual(
            EnhanceTrigger.decision(transcriptReady: false, transcriptTextLength: 0, mediaStatus: "ready", generationStatus: nil, justStopped: false),
            .noTranscript
        )
    }

    func testPlaceholderTitleYieldsToTheGeneratedOne() {
        XCTAssertTrue(EnhanceTrigger.titleIsPlaceholder(""))
        XCTAssertTrue(EnhanceTrigger.titleIsPlaceholder("  New note "))
        XCTAssertFalse(EnhanceTrigger.titleIsPlaceholder("Vayu sync"))
    }
}
