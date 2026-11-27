import Foundation

/// What the video recording HUD says about the microphone.
enum VideoMicStatus: Equatable {
    /// Mic is still starting (can take a few seconds on CoreAudio).
    case starting
    /// Audio is reaching the file and the mic heard sound recently.
    case live
    /// Audio is reaching the file but nothing above the threshold for a
    /// while: wrong input, muted hardware, or just nobody talking.
    case quiet
    /// No audio is reaching the file: the mic failed to start or stopped.
    case noMic

    /// Peak level (linear 0...1) that counts as sound. About -36 dBFS:
    /// above a quiet room on a laptop mic, well below normal speech.
    static let soundThreshold = 0.015
    /// No buffer written for this long means audio has stopped.
    static let writeStallSeconds: TimeInterval = 3
    /// Longest a mic may take to deliver its first buffer before we call
    /// it missing (the start itself times out at 8 s).
    static let firstWriteGraceSeconds: TimeInterval = 10
    /// Silence longer than this flips live to quiet.
    static let quietAfterSeconds: TimeInterval = 10

    static func evaluate(
        current: VideoMicStatus,
        now: Date,
        startedAt: Date,
        lastWriteAt: Date?,
        lastSoundAt: Date?
    ) -> VideoMicStatus {
        guard let lastWriteAt else {
            if current == .noMic { return .noMic }
            return now.timeIntervalSince(startedAt) > firstWriteGraceSeconds ? .noMic : .starting
        }
        if now.timeIntervalSince(lastWriteAt) > writeStallSeconds {
            return .noMic
        }
        let lastHeard = lastSoundAt ?? startedAt
        return now.timeIntervalSince(lastHeard) > quietAfterSeconds ? .quiet : .live
    }
}
