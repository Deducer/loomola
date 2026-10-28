import SwiftUI

/// Stateless pieces of the Granola-shape note header (parity rank 3):
/// the `[My notes │ Transcript]` segmented pill, the Stop / Resume pill
/// and the three live-transcript dots. State and actions stay in
/// `NoteWorkspaceView`.

/// Two-segment capsule. The active segment shows icon + label on a
/// raised fill; the inactive one collapses to its icon (Granola).
struct NoteSegmentedPill: View {
    let notesLabel: String
    let notesIcon: String
    let notesHasMenu: Bool
    let transcriptActive: Bool
    let isLive: Bool
    let onNotes: () -> Void
    let onNotesMenu: () -> Void
    let onTranscript: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            segment(active: !transcriptActive, action: onNotes) {
                Image(systemName: notesIcon)
                    .font(.system(size: 11, weight: .medium))
                if !transcriptActive {
                    Text(notesLabel)
                        .font(DSFont.Body.sm().weight(.medium))
                        .lineLimit(1)
                    if notesHasMenu {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(DSColor.Text.tertiary)
                            .padding(.leading, 2)
                            .contentShape(Rectangle())
                            .overlay { ActionHitArea(action: onNotesMenu) }
                    }
                }
            }
            segment(active: transcriptActive, action: onTranscript) {
                if isLive {
                    LiveDots(active: true)
                } else {
                    Image(systemName: "waveform")
                        .font(.system(size: 11, weight: .medium))
                }
                if transcriptActive {
                    Text("Transcript")
                        .font(DSFont.Body.sm().weight(.medium))
                        .lineLimit(1)
                }
            }
        }
        .padding(3)
        .background(Capsule().fill(DSColor.Bg.surface))
        .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
    }

    private func segment<Content: View>(
        active: Bool,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 6, content: content)
            .foregroundStyle(active ? DSColor.Text.primary : DSColor.Text.secondary)
            .padding(.horizontal, active ? 12 : 10)
            .padding(.vertical, 6)
            .background(
                Capsule().fill(active ? DSColor.Bg.surfaceRaised : Color.clear)
            )
            .contentShape(Capsule())
            .overlay { ActionHitArea(action: action).clipShape(Capsule()) }
    }
}

/// `■ Stop` while recording, `▶ Resume` while paused, `🎙 Resume`
/// (disabled) after the note is saved. One capsule, Granola metrics.
struct NoteStopResumePill: View {
    enum Mode {
        case stop
        case resumePaused
        case resumeSaved
    }

    let mode: Mode
    let action: () -> Void

    var body: some View {
        HStack(spacing: 7) {
            switch mode {
            case .stop:
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(DSColor.Text.primary)
                    .frame(width: 10, height: 10)
                Text("Stop")
            case .resumePaused:
                Image(systemName: "play.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DSColor.Accent.ai)
                Text("Resume")
            case .resumeSaved:
                Image(systemName: "mic")
                    .font(.system(size: 11, weight: .medium))
                Text("Resume")
            }
        }
        .font(DSFont.Body.sm().weight(.medium))
        .foregroundStyle(mode == .resumeSaved ? DSColor.Text.tertiary : DSColor.Text.primary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Capsule().fill(DSColor.Bg.surfaceRaised))
        .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
        .contentShape(Capsule())
        .overlay {
            if mode != .resumeSaved {
                ActionHitArea(action: action).clipShape(Capsule())
            }
        }
        .help(helpText)
    }

    private var helpText: String {
        switch mode {
        case .stop: return "Stop recording and save the note"
        case .resumePaused: return "Resume recording"
        case .resumeSaved: return "Resume lands with the next release"
        }
    }
}

/// Three lime dots that breathe while live transcription runs.
struct LiveDots: View {
    let active: Bool
    @State private var phase = false

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(DSColor.Accent.ai)
                    .frame(width: 4, height: 4)
                    .opacity(active ? (phase ? dotOpacity(index) : 1 - dotOpacity(index) + 0.3) : 0.5)
            }
        }
        .frame(width: 18, height: 12)
        .onAppear {
            guard active else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                phase.toggle()
            }
        }
    }

    private func dotOpacity(_ index: Int) -> Double {
        [1.0, 0.55, 0.3][index]
    }
}
