import AppKit
import SwiftUI

/// One card in the Recent recordings grid (video mode). Shows a
/// 16:9 thumbnail prominent + title + relative timestamp. Click →
/// opens the share page in the default browser.
///
/// Sized at 220×124 thumbnail (16:9) — bumped from the original
/// 140×84 because the previous size made thumbnails too small to
/// be useful as a "browse by frame" cue, which is the whole point
/// of a recent strip for screen recordings.
struct RecentCard: View {
    let recording: RecentRecording
    let onOpen: () -> Void

    @State private var hovering = false

    private let cardWidth: CGFloat = 220
    private let thumbnailHeight: CGFloat = 124

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            thumbnail
                .frame(width: cardWidth, height: thumbnailHeight)
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(recording.title)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(relativeTimestamp)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            .frame(width: cardWidth, alignment: .leading)
        }
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: onOpen) }
        .onHover { hovering = $0 }
        .scaleEffect(hovering ? 1.015 : 1.0)
        .animation(LoomolaMotion.quick, value: hovering)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let url = recording.thumbnailURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .empty: placeholder
                case .success(let image): image.resizable().scaledToFill()
                case .failure: placeholder
                @unknown default: placeholder
                }
            }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        ZStack {
            Rectangle().fill(DSColor.Bg.subtle)
            Image(systemName: recording.kind == .audio ? "waveform" : "video")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
        }
    }

    private var relativeTimestamp: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: recording.createdAt, relativeTo: Date())
    }
}
