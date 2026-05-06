import AppKit
import SwiftUI

/// Granola-shape always-visible audio-recording reminder. A small
/// vertical capsule (~36×88pt) shown for the duration of an audio
/// note recording. Floats on top of every Space and every app
/// (`canJoinAllSpaces + stationary`) so the user is reminded the
/// recording is running even when they're in Zoom, Slack, Chrome,
/// or on a different desktop.
///
/// Visuals:
///   • Loomola brand mark on top
///   • 3-bar live audio meter below (sqrt-curve perceived loudness)
///   • Hover reveals a 6-dot drag grip at the top — drag from the
///     grip to reposition; click anywhere else opens the workspace
///   • Border tints accent on press; capsule scales 0.97 on press
///   • Position persists across recordings via UserDefaults so it
///     returns to the same spot
///
/// `sharingType: .none` ensures the pill never appears in the
/// user's own screen captures (matches BubbleOverlay's pattern).
///
/// Replaces the in-app `RecordingStatusPill` from Stage 8 — the
/// floating pill is the single audio-recording reminder surface.
@MainActor
final class RecordingStatusOverlayController {
    private var panel: NSPanel?
    private var positionStore: PositionStore = .userDefaults

    func show(
        viewModel: RecorderViewModel,
        onTap: @escaping () -> Void
    ) {
        let size = NSSize(width: 36, height: 88)

        let panel = panel ?? NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        let view = RecordingStatusOverlayView(
            viewModel: viewModel,
            onTap: { [weak self] in
                guard self != nil else { return }
                onTap()
            },
            onDragChanged: { [weak self] translation in
                self?.handleDragChanged(translation: translation, size: size)
            },
            onDragEnded: { [weak self] in
                self?.handleDragEnded()
            }
        )

        if panel.contentView == nil {
            panel.contentView = NSHostingView(rootView: view)
        } else if let host = panel.contentView as? NSHostingView<RecordingStatusOverlayView> {
            host.rootView = view
        }

        panel.setContentSize(size)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .stationary,
            .fullScreenAuxiliary,
        ]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.sharingType = .none

        let isNew = self.panel == nil
        if isNew {
            let origin = positionStore.read() ?? Self.defaultOrigin(for: size)
            panel.setFrameOrigin(Self.clamp(origin: origin, size: size))
            self.dragOrigin = origin
        }
        panel.orderFrontRegardless()
        self.panel = panel
    }

    func hide() {
        panel?.orderOut(nil)
    }

    var isVisible: Bool {
        panel?.isVisible ?? false
    }

    // MARK: - Drag

    /// The frame origin at the start of a drag — captured the
    /// first time `handleDragChanged` fires for the gesture so
    /// translations are relative.
    private var dragOrigin: NSPoint?
    private var dragStartedAt: NSPoint?

    private func handleDragChanged(translation: CGSize, size: NSSize) {
        guard let panel else { return }
        if dragStartedAt == nil {
            dragStartedAt = panel.frame.origin
        }
        guard let start = dragStartedAt else { return }
        // SwiftUI translation y is downward (positive = drag down);
        // macOS panel y is upward (positive = up). Flip dy.
        let proposed = NSPoint(
            x: start.x + translation.width,
            y: start.y - translation.height
        )
        let clamped = Self.clamp(origin: proposed, size: size)
        panel.setFrameOrigin(clamped)
        dragOrigin = clamped
    }

    private func handleDragEnded() {
        dragStartedAt = nil
        if let origin = dragOrigin {
            positionStore.write(origin)
        }
    }

    // MARK: - Geometry

    private static func defaultOrigin(for size: NSSize) -> NSPoint {
        let frame = NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSPoint(
            x: frame.maxX - size.width - 24,
            y: frame.maxY - size.height - 24
        )
    }

    private static func clamp(origin: NSPoint, size: NSSize) -> NSPoint {
        let frame = NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let x = max(frame.minX, min(frame.maxX - size.width, origin.x))
        let y = max(frame.minY, min(frame.maxY - size.height, origin.y))
        return NSPoint(x: x, y: y)
    }
}

/// UserDefaults-backed position recall. Pulled into a tiny enum
/// so the controller's drag math doesn't reach into UserDefaults
/// directly — easier to swap out for in-memory storage in tests.
private enum PositionStore {
    case userDefaults

    private static let key = "loomola.recordingPill.position"

    func read() -> NSPoint? {
        guard let dict = UserDefaults.standard.dictionary(forKey: Self.key),
              let x = dict["x"] as? Double,
              let y = dict["y"] as? Double else {
            return nil
        }
        return NSPoint(x: x, y: y)
    }

    func write(_ origin: NSPoint) {
        UserDefaults.standard.set(
            ["x": origin.x, "y": origin.y],
            forKey: Self.key
        )
    }
}

// MARK: - SwiftUI content

private struct RecordingStatusOverlayView: View {
    @ObservedObject var viewModel: RecorderViewModel
    let onTap: () -> Void
    let onDragChanged: (CGSize) -> Void
    let onDragEnded: () -> Void

    @State private var hovering = false
    @State private var pressing = false

    var body: some View {
        VStack(spacing: 0) {
            // Drag grip — only visible on hover. Drag gesture is
            // attached just to this region so the rest of the pill
            // remains tap-responsive.
            if hovering {
                DragGripIcon()
                    .frame(width: 24, height: 14)
                    .padding(.top, 4)
                    .gesture(
                        DragGesture(coordinateSpace: .global)
                            .onChanged { onDragChanged($0.translation) }
                            .onEnded { _ in onDragEnded() }
                    )
                    .help("Drag to move")
            }

            BrandLogoMark(size: 22)
                .padding(.top, hovering ? 6 : 14)

            ThreeBarMeter(level: viewModel.audioLevel)
                .padding(.vertical, 14)
        }
        .frame(width: 36)
        .padding(.horizontal, 6)
        .background(
            Capsule()
                .fill(.regularMaterial)
        )
        .overlay {
            Capsule()
                .strokeBorder(borderColor, lineWidth: 1)
        }
        .scaleEffect(pressing ? 0.97 : 1.0)
        .contentShape(Capsule())
        .onHover { hovering = $0 }
        .gesture(
            // Press-down/up tracking + click in one gesture so we
            // can show the press visual feedback. SwiftUI's
            // .onTapGesture doesn't fire onPress callbacks.
            DragGesture(minimumDistance: 0)
                .onChanged { _ in pressing = true }
                .onEnded { gesture in
                    pressing = false
                    // Treat as a tap if the cursor barely moved —
                    // larger distances are drags handled by the
                    // grip's gesture above (this gesture sits
                    // beneath the grip's, so a real drag from the
                    // grip won't reach here).
                    let distance = hypot(gesture.translation.width, gesture.translation.height)
                    if distance < 5 {
                        onTap()
                    }
                }
        )
        .animation(LoomolaMotion.quick, value: hovering)
        .animation(LoomolaMotion.quick, value: pressing)
        .help("Click to open the recording's note")
    }

    private var borderColor: Color {
        if pressing {
            return DSColor.Accent.primary.opacity(0.6)
        } else if hovering {
            return Color.white.opacity(0.18)
        } else {
            return Color.white.opacity(0.10)
        }
    }
}

/// 6-dot drag grip — 2 columns × 3 rows of small filled circles.
/// Mimics the OS-standard "drag handle" affordance.
private struct DragGripIcon: View {
    var body: some View {
        Grid(horizontalSpacing: 3, verticalSpacing: 2) {
            ForEach(0..<3, id: \.self) { _ in
                GridRow {
                    dot
                    dot
                }
            }
        }
        .foregroundStyle(Color.white.opacity(0.45))
    }

    private var dot: some View {
        Circle().frame(width: 2.5, height: 2.5)
    }
}

/// 3-bar live audio meter sized for the floating pill. Sqrt-curve
/// perceived-loudness response so quiet speech still moves the
/// bars (same model as the workspace's 5-bar meter).
private struct ThreeBarMeter: View {
    let level: Double

    private let multipliers: [Double] = [0.65, 1.0, 0.75]

    private var amplified: Double {
        let l = max(0, min(1, level))
        return min(1.0, sqrt(l * 1.6))
    }

    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(0..<3, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(DSColor.State.success)
                    .frame(width: 3, height: barHeight(at: i))
            }
        }
        .frame(width: 18, height: 22, alignment: .center)
        .animation(.interpolatingSpring(stiffness: 180, damping: 15), value: amplified)
    }

    private func barHeight(at index: Int) -> CGFloat {
        let minH = 4.0
        let maxH = 22.0
        let scaled = amplified * multipliers[index]
        return CGFloat(minH + (maxH - minH) * scaled)
    }
}
