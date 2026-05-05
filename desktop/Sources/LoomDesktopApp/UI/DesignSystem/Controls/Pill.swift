import SwiftUI

/// Small status badge. Replaces ad-hoc StatusPill / colored capsules
/// scattered through the existing UI.
struct Pill: View {
    enum Kind {
        case success
        case warning
        case recording
        case muted
        case accent
    }

    let title: String
    let kind: Kind

    init(_ title: String, kind: Kind = .muted) {
        self.title = title
        self.kind = kind
    }

    var body: some View {
        Text(title)
            .font(DSFont.Body.sm())
            .foregroundStyle(textColor)
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, DSSpacing.xs)
            .background(
                backgroundColor,
                in: Capsule(style: .continuous)
            )
    }

    private var textColor: Color {
        switch kind {
        case .success: return DSColor.State.success
        case .warning: return DSColor.State.warning
        case .recording: return DSColor.State.recording
        case .muted: return DSColor.Text.secondary
        case .accent: return DSColor.Accent.primary
        }
    }

    private var backgroundColor: Color {
        switch kind {
        case .success: return DSColor.State.success.opacity(0.14)
        case .warning: return DSColor.State.warning.opacity(0.14)
        case .recording: return DSColor.State.recording.opacity(0.14)
        case .muted: return DSColor.Bg.subtle
        case .accent: return DSColor.Accent.muted
        }
    }
}
