import Foundation

/// How a transcript speaker label reads, given the server's assignment.
/// A name the speaker pipeline couldn't vouch for (`needsReview`, e.g. the
/// final transcript re-numbered the voices) must look uncertain inline —
/// a tooltip alone reads as authoritative at a glance.
struct SpeakerLabelPresentation: Equatable {
    let text: String
    let isUncertain: Bool

    static func make(name: String, assignment: SpeakerAssignmentDTO?) -> SpeakerLabelPresentation {
        // Suggestions (pending, LLM, low-gain, pre-v2) are guesses too.
        if let a = assignment, a.dismissedAt == nil, a.needsReview == true || a.isSuggestion {
            return SpeakerLabelPresentation(text: "\(name)?", isUncertain: true)
        }
        return SpeakerLabelPresentation(text: name, isUncertain: false)
    }
}
