import AppKit
@preconcurrency import AVFoundation

@MainActor
final class BubbleOverlayWindowController {
    private var panel: NSPanel?

    func showPlaceholder() {
        if let panel {
            panel.makeKeyAndOrderFront(nil)
            return
        }

        let contentView = CameraBubbleView(frame: NSRect(x: 0, y: 0, width: 180, height: 180))
        let panel = NSPanel(
            contentRect: NSRect(x: 320, y: 320, width: 180, height: 180),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = contentView
        panel.isMovableByWindowBackground = true
        panel.orderFrontRegardless()
        self.panel = panel
    }

    func hide() {
        panel?.orderOut(nil)
    }

    var currentFrame: CGRect? {
        panel?.frame
    }
}

private final class CameraBubbleView: NSView {
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "cloud.dissonance.loom.desktop.camera-preview")
    private let previewLayer: AVCaptureVideoPreviewLayer

    override init(frame frameRect: NSRect) {
        previewLayer = AVCaptureVideoPreviewLayer(session: session)
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = frameRect.width / 2
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.systemPurple.withAlphaComponent(0.82).cgColor
        previewLayer.videoGravity = .resizeAspectFill
        layer?.addSublayer(previewLayer)
        startCameraPreview()
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func layout() {
        super.layout()
        previewLayer.frame = bounds
        layer?.cornerRadius = min(bounds.width, bounds.height) / 2
    }

    private func startCameraPreview() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureAndStart()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                if granted {
                    Task { @MainActor in
                        self?.configureAndStart()
                    }
                }
            }
        default:
            break
        }
    }

    private func configureAndStart() {
        sessionQueue.async { [session] in
            guard !session.isRunning else { return }
            session.beginConfiguration()
            session.sessionPreset = .medium
            if
                session.inputs.isEmpty,
                let device = AVCaptureDevice.default(for: .video),
                let input = try? AVCaptureDeviceInput(device: device),
                session.canAddInput(input)
            {
                session.addInput(input)
            }
            session.commitConfiguration()
            session.startRunning()
        }
    }
}
