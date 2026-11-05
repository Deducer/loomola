import XCTest
@testable import LoomDesktopApp

final class NoteResumePolicyTests: XCTestCase {
    func testReadyAudioNoteCanResume() {
        XCTAssertEqual(
            NoteResumePolicy.availability(kind: .audio, mediaStatus: "ready", activeRecordingKind: nil, isStartingRecording: false),
            .available
        )
        XCTAssertEqual(
            NoteResumePolicy.availability(kind: .audio, mediaStatus: "failed", activeRecordingKind: nil, isStartingRecording: false),
            .available
        )
    }

    func testTranscribingOrUploadingNoteWaits() {
        XCTAssertEqual(
            NoteResumePolicy.availability(kind: .audio, mediaStatus: "transcribing", activeRecordingKind: nil, isStartingRecording: false),
            .unavailable(reason: "Resume once transcription finishes")
        )
        XCTAssertEqual(
            NoteResumePolicy.availability(kind: .audio, mediaStatus: "uploading", activeRecordingKind: nil, isStartingRecording: false),
            .unavailable(reason: "Resume once the upload finishes")
        )
    }

    func testAnotherRecordingBlocksResume() {
        XCTAssertEqual(
            NoteResumePolicy.availability(kind: .audio, mediaStatus: "ready", activeRecordingKind: .audio, isStartingRecording: false),
            .unavailable(reason: "Stop the current recording first")
        )
        XCTAssertEqual(
            NoteResumePolicy.availability(kind: .audio, mediaStatus: "ready", activeRecordingKind: nil, isStartingRecording: true),
            .unavailable(reason: "Stop the current recording first")
        )
    }

    func testVideoNeverResumes() {
        XCTAssertEqual(
            NoteResumePolicy.availability(kind: .video, mediaStatus: "ready", activeRecordingKind: nil, isStartingRecording: false),
            .unavailable(reason: "Only audio notes can be resumed")
        )
    }
}
