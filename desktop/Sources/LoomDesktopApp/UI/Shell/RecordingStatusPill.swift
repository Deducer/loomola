import SwiftUI

/// Persistent bottom-anchored pill shown on the home view when an
/// audio note recording is active but the user has navigated away
/// from the workspace. Mirrors the workspace's recording control
/// bar (pulsing red dot + timer + meter + Open/Stop) so the user
/// always has one-tap access to either return to the note or end
/// the recording — they can never accidentally lose track of a
/// running capture.
struct RecordingStatusPill: View {
    let startedAt: Date?
    let audioLevel: Double
    let onOpen: () -> Void
    let onStop: () -> Void

    @State private var pulsing = false

    var body: some View {
        HStack(spacing: 0) {
            // Live recording indicator + label.
            HStack(spacing: 8) {
                Circle()
                    .fill(DSColor.State.recording)
                    .frame(width: 10, height: 10)
                    .opacity(pulsing ? 0.45 : 1.0)
                Text("Recording")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
            }
            .padding(.leading, 14)
            .padding(.trailing, 12)

            separator

            // Mono timer.
            if let startedAt {
                TimelineView(.periodic(from: startedAt, by: 1)) { ctx in
                    Text(elapsedString(now: ctx.date, startedAt: startedAt))
                        .font(DSFont.Mono.body())
                        .foregroundStyle(DSColor.Text.secondary)
                        .monospacedDigit()
                }
                .padding(.horizontal, 12)
            }

            separator

            // Audio level meter.
            AudioLevelMeterCompact(level: audioLevel)
                .padding(.horizontal, 12)

            separator

            // Open note — returns to workspace mode.
            Button(action: onOpen) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 11, weight: .medium))
                    Text("Open note")
                        .font(DSFont.Body.md())
                }
                .foregroundStyle(DSColor.Text.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)

            separator

            // Stop & upload — red square inline (matches workspace).
            Button(action: onStop) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(DSColor.State.recording)
                    .frame(width: 12, height: 12)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.plain)
            .help("Stop & upload")
        }
        .background(Capsule().fill(DSColor.Bg.surfaceRaised))
        .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
        .frame(height: 44)
        .dsShadow(.raised)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
    }

    private var separator: some View {
        Rectangle()
            .fill(DSColor.Border.subtle)
            .frame(width: 1, height: 24)
    }

    private func elapsedString(now: Date, startedAt: Date) -> String {
        let total = max(0, Int(now.timeIntervalSince(startedAt)))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }
}

/// Compact 5-bar meter sized for the bottom pill. (The workspace's
/// AudioLevelMeter is a private struct; duplicating here keeps the
/// pill self-contained without forcing an awkward extraction.)
private struct AudioLevelMeterCompact: View {
    let level: Double

    private let multipliers: [Double] = [0.55, 0.85, 1.0, 0.85, 0.6]

    private var amplified: Double {
        let l = max(0, min(1, level))
        return min(1.0, sqrt(l * 1.6))
    }

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(0..<5, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1)
                    .fill(DSColor.Accent.primary.opacity(0.85))
                    .frame(width: 2, height: barHeight(at: i))
            }
        }
        .frame(width: 22, height: 18, alignment: .center)
        .animation(.interpolatingSpring(stiffness: 180, damping: 15), value: amplified)
    }

    private func barHeight(at index: Int) -> CGFloat {
        let minH = 3.0
        let maxH = 18.0
        let scaled = amplified * multipliers[index]
        return CGFloat(minH + (maxH - minH) * scaled)
    }
}
