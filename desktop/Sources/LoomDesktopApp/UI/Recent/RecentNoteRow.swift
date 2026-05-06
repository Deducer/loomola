import AppKit
import SwiftUI

/// Granola-style row for the Recent notes list (audio mode). Compact
/// horizontal layout: tinted icon → title → relative time. Click →
/// opens /notes/<slug> in the default browser.
///
/// Why a row instead of a card here: the note's thumbnail is the
/// auto-generated waveform PNG, which carries no informational
/// value — users scan notes by title and meeting context. A dense
/// row layout shows more notes per scroll-screen and matches the
/// Granola pattern users already know.
struct RecentNoteRow: View {
    let recording: RecentRecording
    let onOpen: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: DSSpacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                    .fill(DSColor.Bg.subtle)
                Image(systemName: "doc.text")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            .frame(width: 32, height: 32)

            Text(recording.title)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(relativeTimestamp)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.tertiary)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .frame(height: 52)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(hovering ? DSColor.Bg.subtle : Color.clear)
        )
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: onOpen) }
        .onHover { hovering = $0 }
        .animation(LoomolaMotion.quick, value: hovering)
    }

    private var relativeTimestamp: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: recording.createdAt, relativeTo: Date())
    }
}
