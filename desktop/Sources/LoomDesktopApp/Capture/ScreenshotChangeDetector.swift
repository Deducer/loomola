import Foundation

/// Decides which looks at the meeting window are worth keeping as a screenshot.
///
/// Each look is two frames taken a moment apart. The pair says whether the
/// screen is holding still right now; comparing the second frame with the
/// last kept one says whether it shows something new. This is only a cheap
/// first filter: the server's model has the final say on whether a frame
/// shows shared content at all.
///
/// A frame's signature is a small grayscale grid, and two frames are compared
/// by the share of cells whose brightness moved by more than `cellTolerance`.
/// Two kinds of change have to be told apart from faces fidgeting in a
/// participant strip, and they are found by two rules:
///
/// - **A new slide.** One text slide replacing another in the same template
///   moves only a few percent of cells, about what the faces do. So cells
///   that have recently been moving within pairs (faces, a playing video) are
///   set aside as restless, and a small change among the remaining calm
///   cells counts.
/// - **A new screen.** A demo moves most of the window, and its area is often
///   restless too, because the presenter is mid-click half the time. So a
///   large change counts whatever the restless history says.
struct ScreenshotChangeDetector {
    static let gridWidth = 96
    static let gridHeight = 54

    /// New slide: calm cells that may move within the pair, and calm cells
    /// that must differ from the last kept frame.
    var slideSettledShare = 0.015
    var slideChangedShare = 0.02
    /// New screen: all cells that may move within the pair (talking faces fit
    /// under this, scrolling does not), and cells that must differ.
    var screenSettledShare = 0.06
    var screenChangedShare = 0.12
    /// Before the first keep there is nothing to compare against, so only
    /// stillness is asked for: this much of the whole window may be moving,
    /// or more once the moving part is known to be restless.
    var firstKeepSettledShare = 0.10
    var cellTolerance = 8
    /// A cell is restless when it moved within the pair in at least
    /// `restlessCount` of the last `historyLength` looks.
    var historyLength = 4
    var restlessCount = 2
    /// With fewer calm cells than this share there is nothing to compare.
    var minimumCalmShare = 0.15
    /// Kept frames per recording.
    var keepLimit = 60
    /// Frames sent to the server per recording, kept or not. Bounds model
    /// calls when the window never shows shared content.
    var attemptLimit = 150
    /// Pause after the server says a frame showed no shared content.
    var rejectionCooldown: TimeInterval = 30

    private var lastKept: [UInt8]?
    private var lastKeptAt: TimeInterval?
    private var quietUntil: TimeInterval = 0
    /// Which cells moved within the pair on each of the last few looks.
    private var motionHistory: [[Bool]] = []
    private(set) var keptCount = 0
    private(set) var attemptCount = 0

    struct Verdict: Equatable {
        var keep = false
        /// Share of all cells that moved between the two frames of this look.
        var movedWithinPair: Double?
        /// Share of calm, still cells that differ from the last kept frame.
        var slideChange: Double?
        /// Share of all still cells that differ from the last kept frame.
        var screenChange: Double?
    }

    var isExhausted: Bool { keptCount >= keepLimit || attemptCount >= attemptLimit }

    /// Seconds of recording that must pass after a kept frame before the next.
    /// Widens as frames accumulate, so a long demo cannot spend the whole
    /// allowance in its first few minutes.
    var minimumGap: TimeInterval {
        if keptCount < 10 { return 12 }
        if keptCount < 25 { return 30 }
        return 60
    }

    /// Feed one look: two frames taken a moment apart. `time` is seconds into
    /// the recording. On a keep, the second frame is the one to store.
    mutating func consider(first: [UInt8], second: [UInt8], at time: TimeInterval) -> Verdict {
        var verdict = Verdict()
        guard first.count == second.count, !second.isEmpty else { return verdict }
        let total = second.count

        let moving = Self.changedCells(first, second, tolerance: cellTolerance)
        // Restlessness comes from the looks before this one.
        let calm: [Bool] = (0..<total).map { index in
            motionHistory.reduce(0) { $0 + ($1[index] ? 1 : 0) } < restlessCount
        }
        motionHistory.append(moving)
        if motionHistory.count > historyLength { motionHistory.removeFirst() }

        let movedAll = Self.share(moving, among: nil)
        verdict.movedWithinPair = movedAll
        let calmCount = calm.reduce(0) { $0 + ($1 ? 1 : 0) }
        let movedCalm = Self.share(moving, among: calm)

        let still = moving.map { !$0 }
        let calmAndStill = zip(calm, still).map { $0 && $1 }
        if let lastKept, lastKept.count == total {
            let differs = Self.changedCells(lastKept, second, tolerance: cellTolerance)
            verdict.slideChange = Self.share(differs, among: calmAndStill)
            verdict.screenChange = Self.share(differs, among: still)
        }

        guard !isExhausted, time >= quietUntil, !Self.isBlank(second) else { return verdict }
        if let lastKeptAt, time - lastKeptAt < minimumGap { return verdict }

        let calmIsStill = Double(calmCount) >= minimumCalmShare * Double(total)
            && movedCalm <= slideSettledShare
        let isNew: Bool
        if lastKept == nil {
            isNew = movedAll <= firstKeepSettledShare || calmIsStill
        } else {
            let newSlide = calmIsStill && (verdict.slideChange ?? 0) >= slideChangedShare
            let newScreen = movedAll <= screenSettledShare
                && (verdict.screenChange ?? 0) >= screenChangedShare
            isNew = newSlide || newScreen
        }
        guard isNew else { return verdict }

        lastKept = second
        lastKeptAt = time
        keptCount += 1
        attemptCount += 1
        verdict.keep = true
        return verdict
    }

    /// The server dropped the last kept frame: nothing was being shared. The
    /// frame stays the comparison point, so the same view is not sent again.
    mutating func lastKeepWasRejected(at time: TimeInterval) {
        keptCount = max(0, keptCount - 1)
        quietUntil = time + rejectionCooldown
    }

    /// The last kept frame never reached the server. Forget it so the next
    /// still look at the same content is tried again.
    mutating func lastKeepFailed() {
        keptCount = max(0, keptCount - 1)
        lastKept = nil
        lastKeptAt = nil
    }

    static func changedCells(_ a: [UInt8], _ b: [UInt8], tolerance: Int) -> [Bool] {
        zip(a, b).map { abs(Int($0) - Int($1)) > tolerance }
    }

    /// Share of all cells that differ between two signatures.
    static func fractionChanged(_ a: [UInt8], _ b: [UInt8], tolerance: Int) -> Double {
        guard a.count == b.count, !a.isEmpty else { return 1 }
        return share(changedCells(a, b, tolerance: tolerance), among: nil)
    }

    /// Share of the cells in `mask` (all cells when nil) that are set in `cells`.
    private static func share(_ cells: [Bool], among mask: [Bool]?) -> Double {
        var hits = 0
        var considered = 0
        for index in cells.indices where mask?[index] ?? true {
            considered += 1
            if cells[index] { hits += 1 }
        }
        return considered > 0 ? Double(hits) / Double(considered) : 0
    }

    /// A minimised or still-loading window comes back as one flat colour.
    static func isBlank(_ signature: [UInt8]) -> Bool {
        guard let low = signature.min(), let high = signature.max() else { return true }
        return Int(high) - Int(low) < 8
    }
}
