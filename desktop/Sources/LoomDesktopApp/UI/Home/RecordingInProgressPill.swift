import SwiftUI

/// What the home title bar says while an audio note is capturing
/// (parity rank 7). Granola shows "••• New note ✕" at the top centre
/// and keeps the elapsed time out of the window entirely.
struct RecordingInProgressPillModel: Equatable {
    let title: String

    var label: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "New note" : trimmed
    }
}

/// The only place the elapsed time survives: the menu bar item,
/// next to the logo, while a note records.
enum RecordingElapsedFormatter {
    static func string(seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }

    /// Elapsed capture time, with paused stretches removed.
    static func elapsed(
        now: Date,
        startedAt: Date,
        pausedAt: Date?,
        pausedAccumulatedSeconds: TimeInterval
    ) -> TimeInterval {
        let end = pausedAt ?? now
        return end.timeIntervalSince(startedAt) - pausedAccumulatedSeconds
    }
}

struct RecordingInProgressPill: View {
    let label: String
    let isPaused: Bool
    /// Discard in flight: the pill reports it instead of the title and
    /// takes no clicks until the local audio is gone.
    var isDiscarding: Bool = false
    let onOpen: () -> Void
    let onStop: () -> Void

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            if isDiscarding {
                ProgressView()
                    .controlSize(.mini)
                    .frame(width: 18, height: 12)
            } else {
                LiveDots(active: !isPaused)
            }
            Text(isDiscarding ? "Discarding audio note…" : label)
                .font(DSFont.Body.md().weight(.medium))
                .foregroundStyle(isDiscarding ? DSColor.Text.secondary : DSColor.Text.primary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 220)
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DSColor.Text.secondary)
                .frame(width: 20, height: 20)
                .opacity(isDiscarding ? 0 : 1)
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 5)
        // Hug the label (the frame cap above only truncates long
        // titles); without this the overlay stretches the pill.
        .fixedSize(horizontal: true, vertical: false)
        .background(Capsule().fill(DSColor.Bg.surface))
        .overlay { Capsule().strokeBorder(DSColor.Border.strong, lineWidth: 1) }
        .contentShape(Capsule())
        .overlay {
            ActionHitArea(isEnabled: !isDiscarding, action: onOpen)
                .clipShape(Capsule())
        }
        .overlay(alignment: .trailing) {
            ActionHitArea(isEnabled: !isDiscarding, action: onStop)
                .frame(width: 26, height: 26)
                .padding(.trailing, 3)
                .help("Stop and save the note")
        }
        .help("Open the note")
    }
}
