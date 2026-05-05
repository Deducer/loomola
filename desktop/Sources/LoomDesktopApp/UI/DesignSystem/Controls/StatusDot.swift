import SwiftUI

/// 8px colored dot + label. Used for connection / integration
/// status indicators (e.g., title bar "Online" pill, recording
/// active light).
struct StatusDot: View {
    enum Kind {
        case success
        case warning
        case recording
        case offline
        case accent
    }

    let kind: Kind
    let label: String?

    init(_ kind: Kind, label: String? = nil) {
        self.kind = kind
        self.label = label
    }

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            if let label {
                Text(label)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
            }
        }
    }

    private var color: Color {
        switch kind {
        case .success: return DSColor.State.success
        case .warning: return DSColor.State.warning
        case .recording: return DSColor.State.recording
        case .offline: return DSColor.Text.tertiary
        case .accent: return DSColor.Accent.primary
        }
    }
}
