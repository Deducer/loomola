import SwiftUI

/// App-level toasts (parity rank 9): bottom-right, dark, 4 s, with an
/// optional Undo. Used for actions that leave the surface they
/// started on, such as moving a note to trash from its workspace.
@MainActor
final class ToastCenter: ObservableObject {
    static let shared = ToastCenter()

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let message: String
        let undo: (@MainActor () async -> Void)?

        static func == (lhs: Toast, rhs: Toast) -> Bool { lhs.id == rhs.id }
    }

    @Published private(set) var current: Toast?
    private var dismissTask: Task<Void, Never>?

    func show(_ message: String, undo: (@MainActor () async -> Void)? = nil, seconds: Double = 4) {
        let toast = Toast(message: message, undo: undo)
        current = toast
        dismissTask?.cancel()
        dismissTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled, current == toast else { return }
            current = nil
        }
    }

    func dismiss() {
        dismissTask?.cancel()
        current = nil
    }
}

struct ShellToastView: View {
    @ObservedObject var center: ToastCenter

    var body: some View {
        if let toast = center.current {
            HStack(spacing: DSSpacing.md) {
                Text(toast.message)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(2)
                if let undo = toast.undo {
                    Text("Undo")
                        .font(DSFont.Body.sm().weight(.medium))
                        .foregroundStyle(DSColor.Text.primary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(RoundedRectangle(cornerRadius: DSRadius.sm).fill(DSColor.Bg.subtle))
                        .overlay {
                            RoundedRectangle(cornerRadius: DSRadius.sm)
                                .strokeBorder(DSColor.Border.strong, lineWidth: 1)
                        }
                        .contentShape(Rectangle())
                        .overlay {
                            ActionHitArea {
                                center.dismiss()
                                Task { await undo() }
                            }
                        }
                }
            }
            .padding(.leading, DSSpacing.lg)
            .padding(.trailing, toast.undo == nil ? DSSpacing.lg : DSSpacing.sm)
            .padding(.vertical, DSSpacing.sm)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: DSRadius.md).fill(DSColor.Bg.surfaceRaised))
            .overlay {
                RoundedRectangle(cornerRadius: DSRadius.md)
                    .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
            }
            .dsShadow(.raised)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
