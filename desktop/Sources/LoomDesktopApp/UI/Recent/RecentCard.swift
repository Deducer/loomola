import AppKit
import SwiftUI

/// One card in the Recent recordings grid (video mode). Shows a
/// 16:9 thumbnail with a subtle border and shadow, then title +
/// relative timestamp. Click → opens the share page.
///
/// The border + shadow are deliberate: dark thumbnails (anything on a
/// black background) blend into the canvas without a visible edge.
/// The shadow gives them lift; the border keeps the silhouette
/// readable when the shadow is subtle.
struct RecentCard: View {
    let recording: RecentRecording
    let onOpen: () -> Void

    @State private var hovering = false

    // 16:9 cards sized so 3 fit comfortably in the default 1080pt
    // window AND don't overflow at the 920pt min width: 3 × 264 +
    // 2 × 16 (lg gap) + 64 (xxl horizontal padding × 2) = 824pt
    // content vs. 920–1080pt window → 96–256pt margin on each side.
    private let cardWidth: CGFloat = 264
    private let thumbnailHeight: CGFloat = 148  // 16:9 (264 × 9/16 ≈ 148.5)

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            thumbnail
                .frame(width: cardWidth, height: thumbnailHeight)
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
                }
                .dsShadow(hovering ? .raised : .subtle)
            VStack(alignment: .leading, spacing: 2) {
                Text(recording.title)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(relativeTimestamp)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
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
