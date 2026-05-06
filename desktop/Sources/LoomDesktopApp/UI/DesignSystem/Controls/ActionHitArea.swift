import AppKit
import SwiftUI

/// Transparent AppKit click target used by the desktop design-system
/// controls. It deliberately bypasses SwiftUI's `ButtonGesture`
/// dispatch path, which is the frame where macOS 26.4.1 is aborting
/// in Ian's crash reports.
struct ActionHitArea: NSViewRepresentable {
    let isEnabled: Bool
    let action: () -> Void

    init(isEnabled: Bool = true, action: @escaping () -> Void) {
        self.isEnabled = isEnabled
        self.action = action
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeNSView(context: Context) -> TransparentActionButton {
        let button = TransparentActionButton()
        button.target = context.coordinator
        button.action = #selector(Coordinator.performAction)
        button.isEnabled = isEnabled
        return button
    }

    func updateNSView(_ button: TransparentActionButton, context: Context) {
        context.coordinator.action = action
        button.isEnabled = isEnabled
    }

    final class Coordinator: NSObject {
        var action: () -> Void

        init(action: @escaping () -> Void) {
            self.action = action
        }

        @objc func performAction() {
            action()
        }
    }
}

final class TransparentActionButton: NSButton {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        title = ""
        isBordered = false
        isTransparent = true
        bezelStyle = .regularSquare
        focusRingType = .none
        setButtonType(.momentaryChange)
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        title = ""
        isBordered = false
        isTransparent = true
        bezelStyle = .regularSquare
        focusRingType = .none
        setButtonType(.momentaryChange)
    }

    override var acceptsFirstResponder: Bool { false }
}
