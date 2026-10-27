import Foundation

/// How much silence to write when the mic engine comes back after a
/// mid-note restart (AirPods connecting, Zoom grabbing the input, a
/// sample-rate change). Without it the mic track would simply be shorter
/// than the system track after every restart, and everything the user
/// said afterwards would drift earlier than the call audio — breaking the
/// mix and the server's mic-vs-system speaker detection.
///
/// Pure value type so the arithmetic is testable without audio hardware.
/// Times are `ProcessInfo.systemUptime` seconds; paused time is excluded
/// because pausing deliberately elides audio from BOTH tracks.
struct MicRestartGapTracker {
    private(set) var gapStartUptime: TimeInterval?
    private var pausedTotalAtGapStart: TimeInterval = 0

    var isOpen: Bool { gapStartUptime != nil }

    /// Called when the engine is torn down for a restart. Keeps the
    /// earliest start if a restart fails and is retried.
    mutating func open(lastBufferUptime: TimeInterval, pausedTotal: TimeInterval) {
        guard gapStartUptime == nil else { return }
        gapStartUptime = lastBufferUptime
        pausedTotalAtGapStart = pausedTotal
    }

    /// Called with the first buffer after the restart. Returns the
    /// silence to insert before it (0 when the gap was negligible) and
    /// closes the gap.
    mutating func close(
        arrivalUptime: TimeInterval,
        bufferDuration: TimeInterval,
        pausedTotal: TimeInterval
    ) -> TimeInterval {
        guard let start = gapStartUptime else { return 0 }
        gapStartUptime = nil
        let pausedDuringGap = max(0, pausedTotal - pausedTotalAtGapStart)
        // The incoming buffer's audio began `bufferDuration` before it
        // arrived; the previous buffer's audio ended when it arrived.
        let gap = (arrivalUptime - bufferDuration) - start - pausedDuringGap
        return gap >= Self.minimumGap ? min(gap, Self.maximumGap) : 0
    }

    /// Below this, scheduling jitter — not worth a silence write.
    static let minimumGap: TimeInterval = 0.05
    static let maximumGap: TimeInterval = 4 * 3600
}
