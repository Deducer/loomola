import XCTest
@testable import LoomDesktopApp

final class RecorderStateMachineTests: XCTestCase {
    func testStartsSignedOut() {
        let sm = RecorderStateMachine()
        XCTAssertEqual(sm.state, .signedOut)
    }

    func testNormalLifecycle() {
        let sm = RecorderStateMachine()
        XCTAssertNotNil(sm.apply(.signedIn))
        XCTAssertEqual(sm.state, .signedInIdle)

        XCTAssertNotNil(sm.apply(.preflightStarted))
        XCTAssertEqual(sm.state, .preparingPermissions)

        XCTAssertNotNil(sm.apply(.preflightCleared))
        XCTAssertEqual(sm.state, .readyToRecord)

        XCTAssertNotNil(sm.apply(.recordingStarted))
        XCTAssertEqual(sm.state, .recording)

        XCTAssertNotNil(sm.apply(.recordingFinalized))
        XCTAssertEqual(sm.state, .finalizing)

        XCTAssertNotNil(sm.apply(.uploadStarted))
        XCTAssertEqual(sm.state, .uploading(progress: 0))

        XCTAssertNotNil(sm.apply(.uploadProgressed(0.5)))
        XCTAssertEqual(sm.state, .uploading(progress: 0.5))

        XCTAssertNotNil(sm.apply(.uploadCompleted(slug: "abc")))
        XCTAssertEqual(sm.state, .complete(slug: "abc"))

        XCTAssertNotNil(sm.apply(.reset))
        XCTAssertEqual(sm.state, .signedInIdle)
    }

    func testPauseResumeFromRecording() {
        let sm = RecorderStateMachine(initial: .recording)
        XCTAssertNotNil(sm.apply(.recordingPaused))
        XCTAssertEqual(sm.state, .paused)
        XCTAssertNotNil(sm.apply(.recordingResumed))
        XCTAssertEqual(sm.state, .recording)
    }

    func testPauseFromIdleIsRejected() {
        let sm = RecorderStateMachine(initial: .signedInIdle)
        XCTAssertNil(sm.apply(.recordingPaused))
        XCTAssertEqual(sm.state, .signedInIdle, "rejected events leave state unchanged")
    }

    func testRecordingStartedFromIdleIsRejected() {
        // Must go through preflight first.
        let sm = RecorderStateMachine(initial: .signedInIdle)
        XCTAssertNil(sm.apply(.recordingStarted))
        XCTAssertEqual(sm.state, .signedInIdle)
    }

    func testFinalizeFromPaused() {
        let sm = RecorderStateMachine(initial: .paused)
        XCTAssertNotNil(sm.apply(.recordingFinalized))
        XCTAssertEqual(sm.state, .finalizing)
    }

    func testUploadFailedFromUploading() {
        let sm = RecorderStateMachine(initial: .uploading(progress: 0.3))
        XCTAssertNotNil(sm.apply(.uploadFailed(message: "network down")))
        XCTAssertEqual(sm.state, .failed(message: "network down"))
    }

    func testSignedOutFromAnyState() {
        for initial: RecorderState in [
            .signedInIdle,
            .preparingPermissions,
            .readyToRecord,
            .recording,
            .paused,
            .finalizing,
            .uploading(progress: 0.4),
            .complete(slug: "x"),
            .failed(message: "err"),
        ] {
            let sm = RecorderStateMachine(initial: initial)
            XCTAssertNotNil(
                sm.apply(.signedOut),
                "should always allow signOut from \(initial)"
            )
            XCTAssertEqual(sm.state, .signedOut)
        }
    }

    func testResetReturnsToIdleWhenSignedIn() {
        let sm = RecorderStateMachine(initial: .failed(message: "x"))
        XCTAssertNotNil(sm.apply(.reset))
        XCTAssertEqual(sm.state, .signedInIdle)
    }

    func testResetWhenSignedOutStaysSignedOut() {
        let sm = RecorderStateMachine(initial: .signedOut)
        XCTAssertNotNil(sm.apply(.reset))
        XCTAssertEqual(sm.state, .signedOut)
    }
}
