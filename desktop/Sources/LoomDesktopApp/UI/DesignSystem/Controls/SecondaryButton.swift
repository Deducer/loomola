import SwiftUI

/// Secondary action button. Matches PrimaryButton's pill radius +
/// padding rhythm, but uses a subtle bordered surface so it can sit
/// next to a Primary without competing.
struct SecondaryButton: View {
    let title: String
    let icon: String?
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    init(_ title: String, icon: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: DSSpacing.sm) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                }
                Text(title)
            }
            .font(DSFont.Body.lg())
        }
        .buttonStyle(SecondaryButtonStyle())
        .disabled(!isEnabled)
    }
}

private struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(DSColor.Text.primary)
            .padding(.horizontal, DSSpacing.xl)
            .padding(.vertical, DSSpacing.md)
            .background(
                DSColor.Bg.surface,
                in: RoundedRectangle(cornerRadius: DSRadius.pill, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.pill, style: .continuous)
                    .strokeBorder(DSColor.Border.strong, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .opacity(isEnabled ? 1.0 : 0.5)
            .animation(LoomolaMotion.quick, value: configuration.isPressed)
    }
}
