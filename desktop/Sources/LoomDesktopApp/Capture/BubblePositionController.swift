import Foundation
import os

/// Thread-safe holder for the most recent `BubblePlacement`. The bubble
/// overlay window writes to it on every drag tick; the future
/// `CompositeRecorder` reads from it on every screen frame to draw the
/// bubble at the live position. Mirrors the web app's
/// `BubblePositionController` pattern in `src/lib/recording/`.
///
/// Reads and writes are O(1) under an unfair lock — there's no contention
/// budget concern for two callers (UI + compositor) running at 30-60 Hz.
final class BubblePositionController: @unchecked Sendable {
    /// One-per-process shared instance so the bubble overlay (which
    /// publishes on every drag tick) and the compositor (which reads
    /// on every screen frame) talk through the same controller.
    static let shared = BubblePositionController()

    private let lock = OSAllocatedUnfairLock<State>(initialState: State())

    init() {}

    func set(_ placement: BubblePlacement?) {
        lock.withLock { state in
            state.current = placement
        }
    }

    func current() -> BubblePlacement? {
        lock.withLock { state in
            state.current
        }
    }

    private struct State {
        var current: BubblePlacement?
    }
}
