import Foundation

/// What the note should do about AI notes when it (re)appears
/// (parity rank 6). Granola generates the moment a recording stops,
/// from the live transcript; the batch transcript refines later.
enum EnhanceDecision: Equatable {
    /// Kick off generation now, without a click.
    case generateNow
    /// Show the Generate / Regenerate pill and wait for the user.
    case showGenerate
    /// Generation is already running or queued; just poll.
    case inProgress
    /// No transcript text exists yet (upload or transcription still
    /// running); show "Waiting for transcript".
    case waitForTranscript
    /// Transcript finished empty: nothing to generate from.
    case noTranscript
}

enum EnhanceTrigger {
    /// The stop path saves "New note" when the user never typed a
    /// title; the AI title may replace that, but never a typed one.
    static func titleIsPlaceholder(_ title: String) -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty || trimmed.caseInsensitiveCompare("New note") == .orderedSame
    }

    static func decision(
        transcriptReady: Bool,
        transcriptTextLength: Int?,
        mediaStatus: String?,
        generationStatus: String?,
        justStopped: Bool
    ) -> EnhanceDecision {
        switch generationStatus {
        case "pending", "streaming":
            return .inProgress
        default:
            break
        }
        if transcriptReady {
            return justStopped ? .generateNow : .showGenerate
        }
        if mediaStatus == "uploading" || mediaStatus == "transcribing" || transcriptTextLength == nil {
            return .waitForTranscript
        }
        return .noTranscript
    }
}
