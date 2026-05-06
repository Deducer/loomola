import AppKit
import SwiftUI

/// Granola-style row for the Recent notes list (audio mode). Compact
/// horizontal layout: icon → title → relative time. Click → opens
/// /notes/<slug> in the default browser.
///
/// The icon is the note's first image attachment if it has one
/// (server picks it up via listImageAttachmentsForMediaIds). When
/// there's no attachment, we render a tinted paper icon — never the
/// auto-generated waveform PNG, which carries no informational value.
struct RecentNoteRow: View {
    let recording: RecentRecording
    let onOpen: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: DSSpacing.md) {
            iconView
                .frame(width: 32, height: 32)
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous))

            Text(recording.title)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(relativeTimestamp)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
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

    @ViewBuilder
    private var iconView: some View {
        if let url = recording.thumbnailURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFill()
                default: paperIcon
                }
            }
        } else {
            paperIcon
        }
    }

    private var paperIcon: some View {
        ZStack {
            Rectangle().fill(DSColor.Bg.subtle)
            Image(systemName: "doc.text")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
        }
    }

    private var relativeTimestamp: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: recording.createdAt, relativeTo: Date())
    }
}
