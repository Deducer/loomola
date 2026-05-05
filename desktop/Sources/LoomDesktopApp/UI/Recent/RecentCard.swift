import AppKit
import SwiftUI

/// One card in the Recent strip. Shows thumbnail (or a tinted
/// placeholder for audio notes / missing thumbs) + title + relative
/// timestamp. Click → opens the share page in the default browser.
struct RecentCard: View {
    let recording: RecentRecording
    let onOpen: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                thumbnail
                    .frame(width: 140, height: 84)
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
                .frame(width: 140, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
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
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
        }
    }

    private var relativeTimestamp: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: recording.createdAt, relativeTo: Date())
    }
}
