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

    func testLiveOnlyTranscriptOffersRetryOnceThePipelineIsIdle() {
        // 2026-11-04: the batch callback came back empty for a quiet capture
        // and only the live snapshot survived; nothing offered a retry.
        XCTAssertTrue(
            EnhanceTrigger.offersLiveTranscriptRetry(transcriptState: "live", canRetryTranscript: true, mediaStatus: "ready")
        )
        XCTAssertTrue(
            EnhanceTrigger.offersLiveTranscriptRetry(transcriptState: "live", canRetryTranscript: true, mediaStatus: "failed")
        )
    }

    func testLiveTranscriptDuringNormalStopWindowIsNotARetryCase() {
        // Right after Stop the live snapshot is the transcript while the
        // batch pass runs; that is the normal path, not a stuck note.
        XCTAssertFalse(
            EnhanceTrigger.offersLiveTranscriptRetry(transcriptState: "live", canRetryTranscript: true, mediaStatus: "transcribing")
        )
        XCTAssertFalse(
            EnhanceTrigger.offersLiveTranscriptRetry(transcriptState: "live", canRetryTranscript: true, mediaStatus: "uploading")
        )
    }

    func testBatchOrUnretryableTranscriptsNeverOfferLiveRetry() {
        XCTAssertFalse(
            EnhanceTrigger.offersLiveTranscriptRetry(transcriptState: "ready", canRetryTranscript: false, mediaStatus: "ready")
        )
        XCTAssertFalse(
            EnhanceTrigger.offersLiveTranscriptRetry(transcriptState: "live", canRetryTranscript: false, mediaStatus: "ready")
        )
        XCTAssertFalse(
            EnhanceTrigger.offersLiveTranscriptRetry(transcriptState: nil, canRetryTranscript: nil, mediaStatus: "ready")
        )
    }
}
