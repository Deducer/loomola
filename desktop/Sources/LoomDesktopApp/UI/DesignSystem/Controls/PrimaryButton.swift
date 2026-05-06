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
        .foregroundStyle(.white)
        .padding(.horizontal, DSSpacing.xl)
        .padding(.vertical, DSSpacing.md)
        .background(brandColor)
        .clipShape(RoundedRectangle(cornerRadius: DSRadius.pill, style: .continuous))
        .dsShadow(.brand(color: brandColor))
        .opacity(isActionEnabled ? 1.0 : 0.45)
        .contentShape(RoundedRectangle(cornerRadius: DSRadius.pill, style: .continuous))
        .overlay {
            ActionHitArea(isEnabled: isActionEnabled, action: action)
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.pill, style: .continuous))
        }
        .accessibilityLabel(title)
    }

    private var brandColor: Color {
        switch kind {
        case .standard: return DSColor.Accent.primary
        case .destructive: return DSColor.State.recording
        }
    }

    private var isActionEnabled: Bool {
        isEnabled && !isLoading
    }
}
