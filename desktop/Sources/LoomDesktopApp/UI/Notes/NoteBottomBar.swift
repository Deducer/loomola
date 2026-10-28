import SwiftUI

/// Granola's bottom bar, reduced to what has a backend today (parity
/// rank 8): a 56pt capsule holding Copy text, Open on web and Save to
/// Obsidian. There is no "Ask anything" field; single-note Q&A is a
/// separate roadmap item. Hidden while recording.
struct NoteBottomBar: View {
    let obsidianInFlight: Bool
    let onCopyText: () -> Void
    let onOpenOnWeb: () -> Void
    let onSaveToObsidian: () -> Void

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Spacer(minLength: 0)
            chip("Copy text", icon: "doc.on.doc", action: onCopyText)
            chip("Open on web", icon: "arrow.up.right.square", action: onOpenOnWeb)
            chip(
                obsidianInFlight ? "Saving…" : "Save to Obsidian",
                icon: "externaldrive.badge.arrow.down",
                isEnabled: !obsidianInFlight,
                action: onSaveToObsidian
            )
        }
        .padding(.horizontal, 10)
        .frame(height: 56)
        .frame(maxWidth: NoteWorkspaceLayout.readableContentMaxWidth)
        .background(Capsule().fill(DSColor.Bg.surface))
        .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
        .dsShadow(.subtle)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func chip(
        _ label: String,
        icon: String,
        isEnabled: Bool = true,
        action: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .medium))
            Text(label)
                .font(DSFont.Body.sm().weight(.medium))
                .lineLimit(1)
        }
        .foregroundStyle(isEnabled ? DSColor.Text.primary : DSColor.Text.tertiary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Capsule().fill(DSColor.Bg.subtle))
        .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
        .contentShape(Capsule())
        .overlay {
            ActionHitArea(isEnabled: isEnabled, action: action)
                .clipShape(Capsule())
        }
        .help(label)
    }
}
