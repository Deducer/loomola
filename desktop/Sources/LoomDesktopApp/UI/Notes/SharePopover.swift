import SwiftUI

/// Share popover (parity rank 9). There is no per-person sharing
/// backend yet, so the popover shows who has access (the owner) and
/// the public note link, which is what Granola's Copy link copies.
struct SharePopoverModel: Equatable {
    let apiBase: URL
    let slug: String
    let ownerEmail: String

    var link: URL {
        apiBase.appending(path: "notes").appending(path: slug)
    }

    var ownerInitial: String {
        String(ownerEmail.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
    }

    var linkHost: String {
        apiBase.host() ?? apiBase.absoluteString
    }
}

struct SharePopover: View {
    let model: SharePopoverModel
    let onCopyLink: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            Text("People with access")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.tertiary)

            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle().fill(DSColor.Accent.calendar.opacity(0.35))
                    Text(model.ownerInitial)
                        .font(DSFont.Body.sm().weight(.semibold))
                        .foregroundStyle(DSColor.Text.primary)
                }
                .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text("You")
                            .font(DSFont.Body.md().weight(.medium))
                            .foregroundStyle(DSColor.Text.primary)
                    }
                    Text(model.ownerEmail)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                        .lineLimit(1)
                }
                Spacer(minLength: DSSpacing.md)
                Text("Owner")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
            }

            Divider().overlay(DSColor.Border.subtle)

            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "globe")
                        .font(.system(size: 11, weight: .medium))
                    Text(model.linkHost)
                        .font(DSFont.Body.sm())
                        .lineLimit(1)
                }
                .foregroundStyle(DSColor.Text.secondary)
                Spacer()
                HStack(spacing: 6) {
                    Image(systemName: "link")
                        .font(.system(size: 11, weight: .medium))
                    Text("Copy link")
                        .font(DSFont.Body.sm().weight(.medium))
                }
                .foregroundStyle(DSColor.Text.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().fill(DSColor.Bg.subtle))
                .overlay { Capsule().strokeBorder(DSColor.Border.strong, lineWidth: 1) }
                .contentShape(Capsule())
                .overlay { ActionHitArea(action: onCopyLink).clipShape(Capsule()) }
            }
        }
        .padding(DSSpacing.lg)
        .frame(width: 400)
        .background(DSColor.Bg.surfaceRaised)
    }
}
