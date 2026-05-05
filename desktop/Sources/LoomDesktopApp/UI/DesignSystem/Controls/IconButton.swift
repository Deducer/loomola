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

/// `@State` inside a `ButtonStyle.makeBody` is undefined behavior in
/// SwiftUI — `makeBody` is called fresh per-button and state isn't
/// preserved per-button. On macOS 26.4.1 this manifests as a hard
/// crash in `swift_task_isMainExecutorImpl` reading garbage class
/// metadata when the button gesture dispatches. The proper fix is
/// to extract the body into a real `View` struct that owns the
/// `@State`, and instantiate it from `makeBody`.
private struct IconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        IconButtonStyleBody(configuration: configuration)
    }
}

private struct IconButtonStyleBody: View {
    let configuration: ButtonStyle.Configuration
    @State private var hovering = false

    var body: some View {
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
