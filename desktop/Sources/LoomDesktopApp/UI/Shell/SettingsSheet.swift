import SwiftUI

/// Sheet presented from the title-bar gear icon. Body is populated
/// in Phase 4 with Sources / Permissions / Integrations / Diagnostics
/// sections. For Phase 2 it's a placeholder so the plumbing exists.
struct SettingsSheet: View {
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(DSColor.Border.subtle)
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.xl) {
                    placeholderSection
                }
                .padding(DSSpacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(width: 540, height: 560)
        .background(DSColor.Bg.surface)
    }

    private var header: some View {
        HStack(spacing: DSSpacing.md) {
            Text("Settings")
                .font(DSFont.Display.lg())
                .foregroundStyle(DSColor.Text.primary)
            Spacer()
            IconButton(icon: "xmark", size: 28, action: onDismiss)
        }
        .padding(.horizontal, DSSpacing.xl)
        .padding(.vertical, DSSpacing.lg)
    }

    private var placeholderSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            Text("Coming together")
                .font(DSFont.Display.lg())
                .foregroundStyle(DSColor.Text.primary)
            Text("Sources, integrations, permissions, diagnostics, and account land in Phase 4.")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
        }
    }
}
