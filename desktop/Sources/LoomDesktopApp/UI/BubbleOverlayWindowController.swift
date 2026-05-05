@preconcurrency import AppKit
@preconcurrency import AVFoundation
import Foundation

@MainActor
final class BubbleOverlayWindowController {
    /// Read-only access to the live bubble placement. The Phase 1
    /// `CompositeRecorder` reads from this on every screen frame to
    /// project the bubble into captured pixels at the user's last
    /// drag position.
    let positionController: BubblePositionController

    /// Shape used both for the on-screen mask and the placement
    /// published to `positionController`.
    var shape: BubbleShape {
        didSet {
            bubbleView?.applyShape(shape)
            publishCurrentPlacement()
        }
    }

    /// Shared camera session. When provided, the bubble overlay uses
    /// the coordinator's session for its preview layer AND the
    /// `CompositeRecorder` samples from the same coordinator's
    /// `latestPixelBuffer()` — so we never run two camera sessions
    /// on the same device.
    let cameraCoordinator: CameraCaptureCoordinator?

    /// One stationary fullscreen panel hosts the bubble as a
    /// subview. The panel itself never moves — that's the entire
    /// point. macOS native tiling, Stage Manager, and Chrome's
    /// split-view tab snap all fire on window-frame changes, so
    /// keeping the panel parked at the screen frame avoids them
    /// entirely. The bubble visually moves by repositioning its
    /// subview within the container.
    private var hostPanel: BubbleOverlayPanel?
    private var bubbleView: CameraBubbleView?
    private var hoverTimer: DispatchSourceTimer?
    private weak var trackedScreen: NSScreen?

    /// Bubble's current frame in **screen** coordinates (AppKit y-up).
    /// This is the source of truth that drives `BubblePlacement` and
    /// the bubble subview's frame within the container.
    private var currentBubbleFrameInScreen: NSRect = NSRect(
        x: 320, y: 320, width: 180, height: 180
    )

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
        hoverTimer?.cancel()
    }

    func showPlaceholder() {
        // Idempotent camera start. hide() stops the coordinator, so
        // every show must restart it.
        cameraCoordinator?.requestPermissionAndStart(deviceID: nil)

        if let hostPanel {
            // Reset transient state on re-show so a stale isDragging
            // (e.g., a mouseDown that never received its mouseUp) can't
            // pin ignoresMouseEvents=false and swallow clicks across
            // the whole screen.
            bubbleView?.resetTransientInputState()
            hostPanel.ignoresMouseEvents = true
            hostPanel.makeKeyAndOrderFront(nil)
            startHoverTracking()
            publishCurrentPlacement()
            return
        }

        guard let screen = NSScreen.main else { return }
        trackedScreen = screen

        // Fullscreen invisible panel. Stays parked at the screen
        // frame for its entire lifetime.
        let panel = BubbleOverlayPanel(
            contentRect: screen.frame,
            styleMask: [.borderless, .nonactivatingPanel, .hudWindow],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .popUpMenu
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .transient,
            .stationary,
            .ignoresCycle,
        ]
        panel.isMovable = false
        panel.isMovableByWindowBackground = false
        panel.isExcludedFromWindowsMenu = true
        // Default: pass clicks through to the desktop. We flip this
        // to false on hover-over-bubble in `updateHoverState()`.
        panel.ignoresMouseEvents = true
        // Don't capture this window in the screen-recording compositor.
        panel.sharingType = .none

        let container = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
        container.wantsLayer = true
        panel.contentView = container

        // The bubble subview lives inside the container at the
        // bubble's screen coordinates relative to the container's
        // origin (which equals the screen origin).
        let bubble = CameraBubbleView(
            frame: bubbleFrameInContainer(screen: screen),
            sharedSession: cameraCoordinator?.session
        )
        bubble.applyShape(shape)
        bubble.dragHandler = { [weak self] event in
            self?.handleDrag(event: event)
        }
        bubble.scrollHandler = { [weak self] event in
            self?.handleScroll(event: event)
        }
        container.addSubview(bubble)
        bubbleView = bubble

        panel.orderFrontRegardless()
        hostPanel = panel

        startHoverTracking()
        publishCurrentPlacement()
    }

    func hide() {
        hoverTimer?.cancel()
        hoverTimer = nil
        hostPanel?.orderOut(nil)
        hostPanel?.ignoresMouseEvents = true
        positionController.set(nil)
        cameraCoordinator?.stop()
    }

    var currentFrame: CGRect? {
        hostPanel == nil ? nil : currentBubbleFrameInScreen
    }

    /// True when the overlay panel exists and is visible on screen.
    /// Used by the menubar to decide whether to render "Show" or
    /// "Hide" on the toggle item.
    var isVisible: Bool {
        guard let hostPanel else { return false }
        return hostPanel.isVisible
    }

    // MARK: - Drag

    private func handleDrag(event: BubbleDragEvent) {
        guard let bubbleView, let screen = trackedScreen else { return }
        switch event.phase {
        case .began, .changed:
            // The bubble subview lives in container coordinates. The
            // container is parked at the screen origin, so updating
            // the subview's origin in container coords is the same as
            // updating the bubble's screen-coord origin (modulo the
            // container's flippedness — NSView default is y-up).
            let newScreenOrigin = NSPoint(
                x: event.bubbleScreenOriginAtMouseDown.x + event.deltaInScreen.dx,
                y: event.bubbleScreenOriginAtMouseDown.y + event.deltaInScreen.dy
            )
            currentBubbleFrameInScreen = NSRect(
                origin: newScreenOrigin,
                size: currentBubbleFrameInScreen.size
            )
            bubbleView.frame = bubbleFrameInContainer(screen: screen)
            publishCurrentPlacement()
        case .ended:
            publishCurrentPlacement()
        }
    }

    private func handleScroll(event: NSEvent) {
        guard let bubbleView, let screen = trackedScreen else { return }
        let raw = event.scrollingDeltaY != 0 ? event.scrollingDeltaY : event.scrollingDeltaX
        if raw == 0 { return }
        let modifier = event.modifierFlags
        let speed: CGFloat = modifier.contains(.shift) || modifier.contains(.option) ? 0.4 : 1.4
        let delta = raw * speed
        let currentSize = currentBubbleFrameInScreen.size.width
        let newSide = max(90, min(360, currentSize + delta))
        if abs(newSide - currentSize) < 0.5 { return }
        // Keep center fixed.
        let center = NSPoint(
            x: currentBubbleFrameInScreen.midX,
            y: currentBubbleFrameInScreen.midY
        )
        currentBubbleFrameInScreen = NSRect(
            x: center.x - newSide / 2,
            y: center.y - newSide / 2,
            width: newSide,
            height: newSide
        )
        bubbleView.frame = bubbleFrameInContainer(screen: screen)
        publishCurrentPlacement()
    }

    // MARK: - Hover tracking

    /// Polls `NSEvent.mouseLocation` at 60 Hz to decide whether the
    /// cursor is over the bubble's circular hit region. When yes,
    /// flips `ignoresMouseEvents = false` so the bubble subview
    /// receives clicks + scroll. When no, flips back to true so
    /// clicks pass through to whatever's beneath the desktop overlay.
    /// This is the trick that lets a fullscreen invisible window
    /// have per-region click-through without low-level CGEventTap
    /// privileges.
    private func startHoverTracking() {
        hoverTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(16))
        timer.setEventHandler { [weak self] in
            self?.updateHoverState()
        }
        timer.resume()
        hoverTimer = timer
    }

    private func updateHoverState() {
        guard let panel = hostPanel, let _ = bubbleView else { return }
        // Don't special-case isDragging. The bubble visually tracks
        // the cursor during drag, so isCursorInBubble keeps the panel
        // hot. Special-casing isDragging used to pin ignoresMouseEvents
        // to false; if mouseUp ever failed to fire (rare but possible
        // when the panel is hidden mid-click), the entire screen would
        // start swallowing clicks until the bubble was toggled off.
        let cursor = NSEvent.mouseLocation
        let inHit = isCursorInBubble(cursor: cursor)
        if inHit && panel.ignoresMouseEvents {
            panel.ignoresMouseEvents = false
        } else if !inHit && !panel.ignoresMouseEvents {
            panel.ignoresMouseEvents = true
        }
    }

    private func isCursorInBubble(cursor: NSPoint) -> Bool {
        let frame = currentBubbleFrameInScreen
        // For circle, only count points inside the inscribed circle.
        // For rectangle, just frame.contains.
        switch shape {
        case .circle:
            let center = NSPoint(x: frame.midX, y: frame.midY)
            let radius = min(frame.width, frame.height) / 2
            let dx = cursor.x - center.x
            let dy = cursor.y - center.y
            return dx * dx + dy * dy <= radius * radius
        case .rectangle:
            return frame.contains(cursor)
        }
    }

    // MARK: - Position publishing

    private func bubbleFrameInContainer(screen: NSScreen) -> NSRect {
        // Container origin = screen.frame.origin (panel is at screen
        // frame). Bubble screen origin minus container origin gives
        // bubble origin in container coords.
        let dx = currentBubbleFrameInScreen.origin.x - screen.frame.origin.x
        let dy = currentBubbleFrameInScreen.origin.y - screen.frame.origin.y
        return NSRect(
            x: dx,
            y: dy,
            width: currentBubbleFrameInScreen.width,
            height: currentBubbleFrameInScreen.height
        )
    }

    private func publishCurrentPlacement() {
        positionController.set(
            BubblePlacement(
                frameInScreenPoints: currentBubbleFrameInScreen,
                shape: shape
            )
        )
    }
}

/// NSPanel subclass — the only special behavior is `canBecomeKey =
/// false` so the bubble never steals focus from the active app.
private final class BubbleOverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Drag event payload passed from the bubble subview to the
/// controller's drag handler. All coordinates are in screen space.
struct BubbleDragEvent {
    enum Phase { case began, changed, ended }
    let phase: Phase
    let bubbleScreenOriginAtMouseDown: NSPoint
    let deltaInScreen: (dx: CGFloat, dy: CGFloat)
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

    var dragHandler: ((BubbleDragEvent) -> Void)?
    var scrollHandler: ((NSEvent) -> Void)?

    private var dragMouseDownInScreen: NSPoint?
    private var bubbleScreenOriginAtMouseDown: NSPoint?
    private(set) var isDragging = false

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
        // Subtle dark placeholder. The camera preview layer fills the
        // bubble whenever frames are flowing; this background is
        // only visible during the brief gap between session-start
        // and first-frame, or when the camera is permission-denied.
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.32).cgColor
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
        // cornerRadius reflows when scroll-resize changes the frame.
        layer?.cornerRadius = min(bounds.width, bounds.height) / 2
    }

    func applyShape(_ shape: BubbleShape) {
        switch shape {
        case .circle:
            layer?.cornerRadius = min(bounds.width, bounds.height) / 2
        case .rectangle:
            layer?.cornerRadius = 12
        }
    }

    // MARK: - Mouse

    override func mouseDown(with event: NSEvent) {
        dragMouseDownInScreen = NSEvent.mouseLocation
        // Translate self.frame.origin (container coords) → screen
        // coords by going through window.
        if let window {
            let viewOriginInWindow = self.frame.origin
            let viewOriginInScreen = window.convertPoint(toScreen: viewOriginInWindow)
            bubbleScreenOriginAtMouseDown = viewOriginInScreen
        }
        isDragging = true
        if let bubbleScreenOriginAtMouseDown {
            dragHandler?(
                BubbleDragEvent(
                    phase: .began,
                    bubbleScreenOriginAtMouseDown: bubbleScreenOriginAtMouseDown,
                    deltaInScreen: (0, 0)
                )
            )
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard let downAt = dragMouseDownInScreen,
              let initial = bubbleScreenOriginAtMouseDown
        else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - downAt.x
        let dy = now.y - downAt.y
        dragHandler?(
            BubbleDragEvent(
                phase: .changed,
                bubbleScreenOriginAtMouseDown: initial,
                deltaInScreen: (dx, dy)
            )
        )
    }

    override func mouseUp(with event: NSEvent) {
        if let initial = bubbleScreenOriginAtMouseDown {
            dragHandler?(
                BubbleDragEvent(
                    phase: .ended,
                    bubbleScreenOriginAtMouseDown: initial,
                    deltaInScreen: (0, 0)
                )
            )
        }
        resetTransientInputState()
    }

    /// Force-clear in-flight drag state. Called from
    /// `BubbleOverlayWindowController.showPlaceholder` on re-show so a
    /// stale isDragging from a previous lifecycle can't pin the panel
    /// hot.
    func resetTransientInputState() {
        dragMouseDownInScreen = nil
        bubbleScreenOriginAtMouseDown = nil
        isDragging = false
    }

    override func scrollWheel(with event: NSEvent) {
        scrollHandler?(event)
    }

    // MARK: - Camera

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
