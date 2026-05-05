import CoreMedia
import Foundation

/// Pure-logic helper that tracks pause/resume transitions and
/// adjusts incoming sample timestamps so the resulting recording's
/// duration reflects active recording time only — paused gaps are
/// removed entirely from the output stream.
///
/// Usage from a sample tap:
///   let adjustedPTS = adjuster.adjust(rawPTS: pts)
///   if let adjusted = adjustedPTS { ...append sample with adjusted... }
///   // adjustedPTS == nil when paused — drop the sample.
///
/// The math:
///   - On pause(rawPTS:), record the PTS at which we paused
///   - On resume(rawPTS:), compute (rawPTS - pauseStartPTS) and add
///     that to a running totalPaused offset
///   - Every subsequent adjusted PTS = rawPTS - totalPaused
///
/// All operations are pure (no system calls, no shared state outside
/// the struct), so the math can be unit-tested without an audio
/// engine.
struct PauseAdjuster: Equatable, Sendable {
    private(set) var isPaused: Bool = false
    private(set) var totalPaused: CMTime = .zero
    private var pauseStartPTS: CMTime = .invalid

    /// Returns the adjusted PTS for an incoming sample, or nil if
    /// we're currently paused (caller should drop the sample).
    mutating func adjust(rawPTS: CMTime) -> CMTime? {
        if isPaused { return nil }
        return CMTimeSubtract(rawPTS, totalPaused)
    }

    /// Begin a pause. Called from the controlling layer (UI). The
    /// rawPTS is the most recent sample's raw PTS — used as the
    /// reference point for computing the pause duration on resume.
    /// If we're already paused, no-op.
    mutating func pause(atRawPTS rawPTS: CMTime) {
        guard !isPaused else { return }
        isPaused = true
        pauseStartPTS = rawPTS
    }

    /// End a pause. The rawPTS is the next-incoming sample's raw
    /// PTS — used to compute pause duration. If we're not paused,
    /// no-op.
    mutating func resume(atRawPTS rawPTS: CMTime) {
        guard isPaused else { return }
        if pauseStartPTS.isValid && rawPTS.isValid {
            let pauseDuration = CMTimeSubtract(rawPTS, pauseStartPTS)
            if pauseDuration.seconds > 0 {
                totalPaused = CMTimeAdd(totalPaused, pauseDuration)
            }
        }
        isPaused = false
        pauseStartPTS = .invalid
    }

    /// Total seconds skipped via pause. Useful for diagnostics.
    var totalPausedSeconds: Double {
        totalPaused.seconds
    }
}
