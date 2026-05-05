import SwiftUI

/// Circular icon-only button. Used for title-bar gear, account avatar
/// trigger, refresh actions, sheet close.
///
/// Two flavors:
///   - .icon(name): SF Symbol
///   - .text(string): a single character, e.g. "I" for the account avatar
struct IconButton: View {
    enum Content {
        case icon(String)
        case text(String)
    }

    let content: Content
    let size: CGFloat
    let action: () -> Void

    init(icon: String, size: CGFloat = 32, action: @escaping () -> Void) {
        self.content = .icon(icon)
        self.size = size
        self.action = action
    }

    init(text: String, size: CGFloat = 32, action: @escaping () -> Void) {
        self.content = .text(text)
        self.size = size
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Group {
                switch content {
                case .icon(let name):
                    Image(systemName: name)
                        .font(.system(size: size * 0.42, weight: .medium))
                        .foregroundStyle(DSColor.Text.secondary)
                case .text(let s):
                    Text(s)
                        .font(DSFont.Body.lg())
                        .foregroundStyle(DSColor.Accent.primary)
                }
            }
            .frame(width: size, height: size)
        }
        .buttonStyle(IconButtonStyle())
    }
}

private struct IconButtonStyle: ButtonStyle {
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Circle().fill(hovering ? DSColor.Accent.muted : DSColor.Bg.subtle)
            )
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(LoomolaMotion.quick, value: hovering)
            .animation(LoomolaMotion.quick, value: configuration.isPressed)
            .onHover { hovering = $0 }
    }
}
