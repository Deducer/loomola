import Foundation

/// Events that can drive `RecorderStateMachine`. Each maps to a discrete
/// user gesture or system signal — keep them coarse-grained so the
/// transition table stays readable.
enum RecorderEvent: Equatable {
    case signedIn
    case signedOut
    case preflightStarted
    case preflightCleared
    case recordingStarted
    case recordingPaused
    case recordingResumed
    case recordingFinalized
    case uploadStarted
    case uploadProgressed(Double)
    case uploadCompleted(slug: String)
    case uploadFailed(message: String)
    /// Returns to `signedInIdle` (or `signedOut` when no auth). Used when
    /// the user dismisses a completed/failed result and is ready to start
    /// fresh.
    case reset
}

/// Pure transition table over `RecorderState`. Lives outside the view
/// model so transitions are trivial to test in isolation and so the view
/// model has a single place to ask "is this event allowed right now?".
///
/// `apply(_:)` returns the new state on success and `nil` on a rejected
/// transition (state is left unchanged). Callers can ignore rejections
/// silently or surface them as a no-op debug log.
final class RecorderStateMachine {
    private(set) var state: RecorderState

    init(initial: RecorderState = .signedOut) {
        self.state = initial
    }

    @discardableResult
    func apply(_ event: RecorderEvent) -> RecorderState? {
        guard let next = Self.transition(from: state, on: event) else {
            return nil
        }
        state = next
        return next
    }

    /// Pure transition function — exposed for tests and for callers that
    /// want to ask "what would happen if?" without mutating state.
    static func transition(
        from state: RecorderState,
        on event: RecorderEvent
    ) -> RecorderState? {
        // signOut + reset are universal escape hatches.
        switch event {
        case .signedOut:
            return .signedOut
        case .reset:
            return state == .signedOut ? .signedOut : .signedInIdle
        default:
            break
        }

        switch (state, event) {
        case (.signedOut, .signedIn):
            return .signedInIdle

        case (.signedInIdle, .preflightStarted):
            return .preparingPermissions
        // Allow skipping the preflight step when permissions are already
        // green from a previous run — view model can short-circuit by
        // emitting preflightCleared directly.
        case (.signedInIdle, .preflightCleared):
            return .readyToRecord

        case (.preparingPermissions, .preflightCleared):
            return .readyToRecord

        case (.readyToRecord, .recordingStarted):
            return .recording

        case (.recording, .recordingPaused):
            return .paused
        case (.paused, .recordingResumed):
            return .recording

        case (.recording, .recordingFinalized),
             (.paused, .recordingFinalized):
            return .finalizing

        case (.finalizing, .uploadStarted):
            return .uploading(progress: 0)

        case (.uploading, .uploadProgressed(let p)):
            return .uploading(progress: p)
        case (.uploading, .uploadCompleted(let slug)):
            return .complete(slug: slug)
        case (.uploading, .uploadFailed(let m)):
            return .failed(message: m)

        // Recovery from terminal states is via `.reset` (handled above).
        default:
            return nil
        }
    }
}
