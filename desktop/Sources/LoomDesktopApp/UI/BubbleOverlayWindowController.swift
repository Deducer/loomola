@preconcurrency import AppKit
@preconcurrency import AVFoundation

@MainActor
final class BubbleOverlayWindowController {
    /// Read-only access to the live bubble placement. The Phase 1
    /// `CompositeRecorder` reads from this on every screen frame to
    /// project the bubble into captured pixels at the user's last
    /// drag position.
    let positionController: BubblePositionController

    /// Shape used both for the on-screen panel mask and the placement
    /// published to `positionController`. Defaults to circle to match
    /// the existing `CameraBubbleView` cornerRadius behavior.
    var shape: BubbleShape {
        didSet { publishCurrentPlacement() }
    }

    /// Shared camera session. When provided, the bubble overlay uses
    /// the coordinator's session for its preview layer AND the
    /// CompositeRecorder samples from the same coordinator's
    /// `latestPixelBuffer()` — so we never run two camera sessions
    /// on the same device.
    let cameraCoordinator: CameraCaptureCoordinator?

    private var panel: NSPanel?
    private var moveObservation: NSObjectProtocol?

    init(
        positionController: BubblePositionController = BubblePositionController(),
        shape: BubbleShape = .circle,
        cameraCoordinator: CameraCaptureCoordinator? = nil
    ) {
        self.positionController = positionController
        self.shape = shape
        self.cameraCoordinator = cameraCoordinator
    }

    deinit {
        if let moveObservation {
            NotificationCenter.default.removeObserver(moveObservation)
        }
    }

    func showPlaceholder() {
        // Camera coordinator is started on every show, not just the
        // first — hide() stops the session and the early-return below
        // for an existing panel must not skip the restart.
        // requestPermissionAndStart is idempotent (no-op when already
        // running with the same device).
        cameraCoordinator?.requestPermissionAndStart(deviceID: nil)

        if let panel {
            panel.makeKeyAndOrderFront(nil)
            publishCurrentPlacement()
            return
        }

        let contentView = CameraBubbleView(
            frame: NSRect(x: 0, y: 0, width: 180, height: 180),
            sharedSession: cameraCoordinator?.session
        )
        let panel = BubblePanel(
            contentRect: NSRect(x: 320, y: 320, width: 180, height: 180),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        // .popUpMenu sits above .floating and above Stage Manager's
        // window-snap UI. Combined with .transient + .stationary +
        // .ignoresCycle, the panel doesn't appear in Mission Control,
        // doesn't trigger window-arrangement HUDs, and doesn't show
        // up in ⌘` cycling.
        panel.level = .popUpMenu
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .transient,
            .stationary,
            .ignoresCycle,
        ]
        panel.contentView = contentView
        // We implement custom drag in BubblePanel's mouseDown/Dragged
        // handlers — bypassing AppKit's standard window drag avoids
        // triggering Stage Manager / Chrome's split-view snap zones,
        // which fire on any window dragged near a screen edge.
        panel.isMovableByWindowBackground = false
        panel.isMovable = false
        // Hide from ScreenCaptureKit so the compositor's screen
        // capture is "naked" of the overlay — bubble is composited
        // independently at the user's BubblePlacement; capturing it
        // too would draw it twice.
        panel.sharingType = .none
        panel.orderFrontRegardless()
        self.panel = panel

        observeMoves(of: panel)
        publishCurrentPlacement()
    }

    func hide() {
        panel?.orderOut(nil)
        positionController.set(nil)
        cameraCoordinator?.stop()
    }

    var currentFrame: CGRect? {
        panel?.frame
    }

    /// True when the overlay panel exists and is visible on screen.
    /// Used by the menubar to decide whether to render "Show" or
    /// "Hide" on the toggle item.
    var isVisible: Bool {
        guard let panel else { return false }
        return panel.isVisible
    }

    // MARK: - Position publishing

    private func observeMoves(of panel: NSPanel) {
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

/// NSPanel subclass that handles its own drag rather than relying on
/// AppKit's `isMovableByWindowBackground` machinery — that machinery
/// integrates with Stage Manager, the macOS window-arrangement HUDs,
/// and Chrome's split-view snap zones, all of which fire whenever a
/// window crosses a screen edge. A bubble overlay isn't a window in
/// the user's mental model, so we sidestep that whole UI by setting
/// the panel frame programmatically each mouseDragged tick.
private final class BubblePanel: NSPanel {
    private var dragMouseDownInScreen: NSPoint?
    private var dragInitialOrigin: NSPoint?

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    override func mouseDown(with event: NSEvent) {
        dragMouseDownInScreen = NSEvent.mouseLocation
        dragInitialOrigin = frame.origin
    }

    override func mouseDragged(with event: NSEvent) {
        guard let downAt = dragMouseDownInScreen,
              let initialOrigin = dragInitialOrigin
        else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - downAt.x
        let dy = now.y - downAt.y
        setFrameOrigin(NSPoint(x: initialOrigin.x + dx, y: initialOrigin.y + dy))
    }

    override func mouseUp(with event: NSEvent) {
        dragMouseDownInScreen = nil
        dragInitialOrigin = nil
    }
}

private final class CameraBubbleView: NSView {
    /// Either the shared coordinator's session (preferred path) or a
    /// private inline session (fallback when no coordinator was
    /// supplied). When using the shared session, `manageInputs` is
    /// false — the coordinator owns input/output configuration.
    private let session: AVCaptureSession
    private let manageInputs: Bool
    private let sessionQueue = DispatchQueue(label: "cloud.dissonance.loom.desktop.camera-preview")
    private let previewLayer: AVCaptureVideoPreviewLayer

    init(frame frameRect: NSRect, sharedSession: AVCaptureSession?) {
        if let sharedSession {
            session = sharedSession
            manageInputs = false
        } else {
            session = AVCaptureSession()
            manageInputs = true
        }
        previewLayer = AVCaptureVideoPreviewLayer(session: session)
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = frameRect.width / 2
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.systemPurple.withAlphaComponent(0.82).cgColor
        previewLayer.videoGravity = .resizeAspectFill
        layer?.addSublayer(previewLayer)
        if manageInputs {
            startCameraPreview()
        }
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
