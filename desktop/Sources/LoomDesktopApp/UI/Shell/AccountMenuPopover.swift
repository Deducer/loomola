import SwiftUI

/// Popover anchored to the title-bar account avatar. Shows the
/// signed-in user's email + a small action menu (Open dashboard,
/// Open library, Sign out).
struct AccountMenuPopover: View {
    let email: String?
    let onOpenDashboard: () -> Void
    let onOpenLibrary: () -> Void
    let onSignOut: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: DSSpacing.xs) {
                Text("Signed in")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
                Text(email ?? "Not signed in")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.horizontal, DSSpacing.lg)
            .padding(.vertical, DSSpacing.md)

            Divider().overlay(DSColor.Border.subtle)

            menuRow(title: "Open dashboard", icon: "safari", action: onOpenDashboard)
            menuRow(title: "Open library", icon: "rectangle.stack", action: onOpenLibrary)

            Divider().overlay(DSColor.Border.subtle)

            menuRow(
                title: "Sign out",
                icon: "rectangle.portrait.and.arrow.right",
                kind: .destructive,
                action: onSignOut
            )
        }
        .frame(width: 240)
        .background(DSColor.Bg.surfaceRaised)
    }

    @ViewBuilder
    private func menuRow(
        title: String,
        icon: String,
        kind: RowKind = .standard,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: DSSpacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 18)
                Text(title)
                    .font(DSFont.Body.md())
                Spacer()
            }
            .foregroundStyle(kind == .destructive ? DSColor.State.recording : DSColor.Text.primary)
            .padding(.horizontal, DSSpacing.lg)
            .padding(.vertical, DSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(MenuRowButtonStyle())
    }

    private enum RowKind {
        case standard
        case destructive
    }
}

private struct MenuRowButtonStyle: ButtonStyle {
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(hovering ? DSColor.Accent.muted : Color.clear)
            .animation(LoomolaMotion.quick, value: hovering)
            .onHover { hovering = $0 }
    }
}
