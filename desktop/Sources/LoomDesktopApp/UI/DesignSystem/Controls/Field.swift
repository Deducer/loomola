import SwiftUI

/// Branded text input. Subtle background, 1px hairline border that
/// shifts to accent on focus. Replaces every default TextField in
/// the desktop shell.
struct Field: View {
    let placeholder: String
    let icon: String?
    let isSecure: Bool
    @Binding var text: String

    @FocusState private var focused: Bool

    init(
        placeholder: String,
        text: Binding<String>,
        icon: String? = nil,
        isSecure: Bool = false
    ) {
        self.placeholder = placeholder
        self._text = text
        self.icon = icon
        self.isSecure = isSecure
    }

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            Group {
                if isSecure {
                    SecureField(placeholder, text: $text)
                } else {
                    TextField(placeholder, text: $text)
                }
            }
            .textFieldStyle(.plain)
            .font(DSFont.Body.md())
            .foregroundStyle(DSColor.Text.primary)
            .focused($focused)
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, DSSpacing.md)
        .background(
            DSColor.Bg.subtle,
            in: RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .strokeBorder(
                    focused ? DSColor.Accent.primary : DSColor.Border.subtle,
                    lineWidth: focused ? 1.5 : 1
                )
        )
        .animation(LoomolaMotion.quick, value: focused)
    }
}
