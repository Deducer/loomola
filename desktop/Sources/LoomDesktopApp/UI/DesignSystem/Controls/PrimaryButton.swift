import SwiftUI

/// Brand CTA button. Pill radius, accent fill, white label, soft brand
/// shadow on hover. Replaces every `.borderedProminent` callsite in
/// the desktop app shell.
///
/// Use:
///   PrimaryButton("Start recording", icon: "video.fill") { ... }
///   PrimaryButton("Sign in", icon: "arrow.right", kind: .destructive) { ... }
struct PrimaryButton: View {
    let title: String
    let icon: String?
    let kind: Kind
    let isLoading: Bool
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    enum Kind {
        case standard
        case destructive
    }

    init(
        _ title: String,
        icon: String? = nil,
        kind: Kind = .standard,
        isLoading: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.icon = icon
        self.kind = kind
        self.isLoading = isLoading
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: DSSpacing.sm) {
                if isLoading {
                    ProgressView().controlSize(.small).tint(.white)
                } else if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                }
                Text(title)
            }
            .font(DSFont.Body.lg())
        }
        .buttonStyle(PrimaryButtonStyle(kind: kind, isLoading: isLoading))
        .disabled(isLoading || !isEnabled)
    }
}

/// `ButtonStyle.makeBody` should not contain `@State` or really
/// any DynamicProperty wrappers — even `@Environment`, while
/// nominally supported, has surfaced as a runtime crash source on
/// macOS 26.4.1. Extracting the body to a real `View` is the
/// stable pattern.
private struct PrimaryButtonStyle: ButtonStyle {
    let kind: PrimaryButton.Kind
    let isLoading: Bool

    func makeBody(configuration: Configuration) -> some View {
        PrimaryButtonStyleBody(
            configuration: configuration,
            kind: kind,
            isLoading: isLoading
        )
    }
}

private struct PrimaryButtonStyleBody: View {
    let configuration: ButtonStyle.Configuration
    let kind: PrimaryButton.Kind
    let isLoading: Bool

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .foregroundStyle(.white)
            .padding(.horizontal, DSSpacing.xl)
            .padding(.vertical, DSSpacing.md)
            .background(fillColor(pressed: configuration.isPressed))
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.pill, style: .continuous))
            .dsShadow(.brand(color: brandColor))
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .opacity(isEnabled ? 1.0 : 0.45)
            .animation(LoomolaMotion.quick, value: configuration.isPressed)
    }

    private var brandColor: Color {
        switch kind {
        case .standard: return DSColor.Accent.primary
        case .destructive: return DSColor.State.recording
        }
    }

    private func fillColor(pressed: Bool) -> Color {
        let base = brandColor
        if pressed {
            // Darken slightly under press. Color-overlay trick keeps
            // it cheap.
            return base.opacity(0.88)
        }
        return base
    }
}
