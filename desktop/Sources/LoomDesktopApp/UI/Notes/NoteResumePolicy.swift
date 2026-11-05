import Foundation

enum NoteResumeAvailability: Equatable {
    case available
    case unavailable(reason: String)
}

/// Whether a saved note's Resume pill can start another segment. Pure,
/// so the rules are unit-tested; the workspace feeds it the latest
/// media status it has seen for the note.
enum NoteResumePolicy {
    static func availability(
        kind: RecentRecording.Kind,
        mediaStatus: String?,
        activeRecordingKind: DesktopRecordingKind?,
        isStartingRecording: Bool
    ) -> NoteResumeAvailability {
        guard kind == .audio else {
            return .unavailable(reason: "Only audio notes can be resumed")
        }
        if activeRecordingKind != nil || isStartingRecording {
            return .unavailable(reason: "Stop the current recording first")
        }
        switch mediaStatus {
        case nil, "ready", "failed":
            return .available
        case "uploading":
            return .unavailable(reason: "Resume once the upload finishes")
        case "transcribing", "processing":
            return .unavailable(reason: "Resume once transcription finishes")
        case let other?:
            return .unavailable(reason: "Can't resume while the note is \(other)")
        }
    }
}
