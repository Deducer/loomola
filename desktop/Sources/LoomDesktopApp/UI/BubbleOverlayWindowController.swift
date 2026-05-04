@preconcurrency import AppKit
@preconcurrency import AVFoundation

@MainActor
final class BubbleOverlayWindowController {
    /// Read-only access to the live bubble placement. The Phase 1
    /// `CompositeRecorder` will read from this on every screen frame to
    /// project the bubble into captured pixels at the user's last drag
    /// position. Today no consumer reads it, but every drag tick already
    /// publishes a fresh `BubblePlacement`, so the wiring is in place
    /// once the compositor lands.
    let positionController: BubblePositionController

    /// Shape used both for the on-screen panel mask and the placement
    /// published to `positionController`. Defaults to circle to match
    /// the existing `CameraBubbleView` cornerRadius behavior.
    var shape: BubbleShape {
        didSet { publishCurrentPlacement() }
    }

    private var panel: NSPanel?
    private var moveObservation: NSObjectProtocol?

    init(
        positionController: BubblePositionController = BubblePositionController(),
        shape: BubbleShape = .circle
    ) {
        self.positionController = positionController
        self.shape = shape
    }

    deinit {
        if let moveObservation {
            NotificationCenter.default.removeObserver(moveObservation)
        }
    }

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

        observeMoves(of: panel)
        publishCurrentPlacement()
    }

    func hide() {
        panel?.orderOut(nil)
        positionController.set(nil)
    }

    var currentFrame: CGRect? {
        panel?.frame
    }

    // MARK: - Position publishing

    private func observeMoves(of panel: NSPanel) {
        // The drag is owned by AppKit (isMovableByWindowBackground); we
        // just observe the resulting frame change. didMoveNotification
        // fires after every drag tick, which is what we want — the
        // compositor reads the latest value at draw time, no per-pixel
        // burst overhead from this side.
        if let moveObservation {
            NotificationCenter.default.removeObserver(moveObservation)
        }
        moveObservation = NotificationCenter.default.addObserver(
            forName: NSWindow.didMoveNotification,
            object: panel,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.publishCurrentPlacement()
            }
        }
    }

    private func publishCurrentPlacement() {
        guard let panel else {
            positionController.set(nil)
            return
        }
        positionController.set(
            BubblePlacement(
                frameInScreenPoints: panel.frame,
                shape: shape
            )
        )
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
