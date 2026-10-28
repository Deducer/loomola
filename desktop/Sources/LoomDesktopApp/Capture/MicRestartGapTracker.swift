import Foundation

/// How much silence to write when the mic engine comes back after a
/// mid-note restart (AirPods connecting, Zoom grabbing the input, a
/// sample-rate change). Without it the mic track would simply be shorter
/// than the system track after every restart, and everything the user
/// said afterwards would drift earlier than the call audio — breaking the
/// mix and the server's mic-vs-system speaker detection.
///
/// Pure value type so the arithmetic is testable without audio hardware.
/// Times are `ProcessInfo.systemUptime` seconds. Paused time is excluded
/// from the gap because pausing deliberately elides audio from BOTH
/// tracks — including a pause that began after the last buffer but
/// before the restart, which is why the paused total is recorded with
/// every buffer rather than read when the restart happens.
struct MicRestartGapTracker {
    private var lastBufferUptime: TimeInterval?
    private var pausedTotalAtLastBuffer: TimeInterval = 0
    private(set) var gapStartUptime: TimeInterval?
    private var pausedTotalAtGapStart: TimeInterval = 0
    /// Which engine's tap the tracker listens to. A callback still in
    /// flight from the engine being torn down must neither close the gap
    /// (the new engine's audio would then get no silence) nor count as the
    /// last buffer.
    private(set) var activeEpoch = 0

    var isOpen: Bool { gapStartUptime != nil }

    func isCurrent(epoch: Int) -> Bool { epoch == activeEpoch }

    /// Every delivered (unpaused) buffer: when its audio ended, and the
    /// paused total at that moment.
    mutating func markBuffer(uptime: TimeInterval, pausedTotal: TimeInterval) {
        lastBufferUptime = uptime
        pausedTotalAtLastBuffer = pausedTotal
    }

    /// The old engine has been torn down and `nextEpoch`'s is about to
    /// start. The gap starts where the last audio ended; a retried restart
    /// keeps the original start. No gap before any audio (nothing to align
    /// yet).
    mutating func open(nextEpoch: Int) {
        activeEpoch = nextEpoch
        guard gapStartUptime == nil, let lastBufferUptime else { return }
        gapStartUptime = lastBufferUptime
        pausedTotalAtGapStart = pausedTotalAtLastBuffer
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

/// Serializes mic-engine restarts against stop(). Every restart attempt
/// carries the generation it was scheduled in; stop() bumps the
/// generation, so an attempt that was already queued (or a retry after a
/// failed restart) finds itself obsolete and does nothing — it can never
/// start an engine, or touch a writer, after the note has stopped.
/// Mutated only on the coordinator's recovery queue.
struct MicRestartGate {
    private(set) var generation = 0
    private(set) var stopping = false
    private(set) var restarting = false

    /// Starts a restart attempt; nil if stopping or one is in flight.
    mutating func begin() -> Int? {
        guard !stopping, !restarting else { return nil }
        restarting = true
        return generation
    }

    func isCurrent(_ ticket: Int) -> Bool {
        !stopping && ticket == generation
    }

    mutating func finishAttempt() {
        restarting = false
    }

    mutating func stop() {
        stopping = true
        restarting = false
        generation += 1
    }

    mutating func reset() {
        stopping = false
        restarting = false
        generation += 1
    }
}
