import AppKit
import SwiftUI

struct RecordingTranscriptPreviewEntry: Identifiable, Equatable {
    let id: String
    let source: LiveTranscriptAudioSource
    let text: String
    let isInterim: Bool
    let startSec: Double
    let endSec: Double
}

enum RecordingTranscriptPreviewBuilder {
    static func entries(
        segments: [LiveTranscriptSegment],
        interimBySource: [LiveTranscriptAudioSource: String],
        limit: Int = 6
    ) -> [RecordingTranscriptPreviewEntry] {
        guard limit > 0 else { return [] }
        var result: [RecordingTranscriptPreviewEntry] = []

        for segment in segments.sorted(by: { $0.startSec < $1.startSec }) {
            let text = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }

            if let last = result.last,
               last.source == segment.source,
               !last.isInterim,
               segment.startSec - last.endSec < 2.5 {
                result[result.count - 1] = RecordingTranscriptPreviewEntry(
                    id: last.id,
                    source: last.source,
                    text: "\(last.text) \(text)",
                    isInterim: false,
                    startSec: last.startSec,
                    endSec: segment.endSec
                )
            } else {
                result.append(
                    RecordingTranscriptPreviewEntry(
                        id: segment.id.uuidString,
                        source: segment.source,
                        text: text,
                        isInterim: false,
                        startSec: segment.startSec,
                        endSec: segment.endSec
                    )
                )
            }
        }

        for source in LiveTranscriptAudioSource.allCases {
            guard let interim = interimBySource[source]?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !interim.isEmpty
            else { continue }
            result.append(
                RecordingTranscriptPreviewEntry(
                    id: "interim-\(source.rawValue)",
                    source: source,
                    text: interim,
                    isInterim: true,
                    startSec: result.last?.endSec ?? 0,
                    endSec: result.last?.endSec ?? 0
                )
            )
        }

        return Array(result.suffix(limit))
    }
}

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
    private var transcriptPanel: NSPanel?
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
            },
            onHoverChanged: { [weak self, weak viewModel] hovering in
                guard let self, let viewModel else { return }
                self.setTranscriptPreviewVisible(
                    hovering,
                    transcription: viewModel.liveTranscription
                )
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
        transcriptPanel?.orderOut(nil)
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
        positionTranscriptPanel()
        dragOrigin = clamped
    }

    private func handleDragEnded() {
        dragStartedAt = nil
        if let origin = dragOrigin {
            positionStore.write(origin)
        }
    }

    // MARK: - Live transcript preview

    private func setTranscriptPreviewVisible(
        _ visible: Bool,
        transcription: LiveTranscriptionCoordinator
    ) {
        guard visible, panel?.isVisible == true else {
            transcriptPanel?.orderOut(nil)
            return
        }

        let size = NSSize(width: 322, height: 374)
        let transcriptPanel = transcriptPanel ?? NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        let view = RecordingTranscriptPreviewView(transcription: transcription)
        if let host = transcriptPanel.contentView as? NSHostingView<RecordingTranscriptPreviewView> {
            host.rootView = view
        } else {
            transcriptPanel.contentView = NSHostingView(rootView: view)
        }
        transcriptPanel.setContentSize(size)
        transcriptPanel.isOpaque = false
        transcriptPanel.backgroundColor = .clear
        transcriptPanel.hasShadow = true
        transcriptPanel.level = .floating
        transcriptPanel.collectionBehavior = [
            .canJoinAllSpaces,
            .stationary,
            .fullScreenAuxiliary,
        ]
        transcriptPanel.hidesOnDeactivate = false
        transcriptPanel.ignoresMouseEvents = true
        transcriptPanel.sharingType = .none
        self.transcriptPanel = transcriptPanel
        positionTranscriptPanel()
        transcriptPanel.orderFrontRegardless()
    }

    private func positionTranscriptPanel() {
        guard let panel, let transcriptPanel else { return }
        let pillFrame = panel.frame
        let previewSize = transcriptPanel.frame.size
        let screen = NSScreen.screens.first { $0.frame.intersects(pillFrame) } ?? NSScreen.main
        let visibleFrame = screen?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let gap: CGFloat = 10
        let preferredLeftX = pillFrame.minX - gap - previewSize.width
        let x = preferredLeftX >= visibleFrame.minX
            ? preferredLeftX
            : min(pillFrame.maxX + gap, visibleFrame.maxX - previewSize.width)
        let y = max(
            visibleFrame.minY,
            min(pillFrame.maxY - previewSize.height, visibleFrame.maxY - previewSize.height)
        )
        transcriptPanel.setFrameOrigin(NSPoint(x: x, y: y))
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
    let onHoverChanged: (Bool) -> Void

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
        .onHover {
            hovering = $0
            onHoverChanged($0)
        }
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

private struct RecordingTranscriptPreviewView: View {
    @ObservedObject var transcription: LiveTranscriptionCoordinator

    private var entries: [RecordingTranscriptPreviewEntry] {
        RecordingTranscriptPreviewBuilder.entries(
            segments: transcription.segments,
            interimBySource: transcription.interimBySource
        )
    }

    private var fingerprint: String {
        entries.map { "\($0.id):\($0.text)" }.joined(separator: "|")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 9) {
                BrandLogoMark(size: 20)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Loomola live transcript")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DSColor.Text.primary)
                    Text(transcription.status.label)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(DSColor.Text.tertiary)
                }
                Spacer(minLength: 8)
                Circle()
                    .fill(statusColor)
                    .frame(width: 7, height: 7)
            }

            Divider().overlay(DSColor.Border.subtle)

            if entries.isEmpty {
                emptyState
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(entries) { entry in
                                transcriptEntry(entry)
                                    .id(entry.id)
                            }
                        }
                    }
                    .onAppear { scrollToLatest(proxy) }
                    .onChange(of: fingerprint) { _, _ in scrollToLatest(proxy) }
                }
            }

            Text("Click the Loomola pill to open the note")
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary.opacity(0.82))
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(14)
        .frame(width: 322, height: 374)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.Bg.surface.opacity(0.98))
        )
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        switch transcription.status {
        case .disabled:
            statusMessage("Live transcription is off. Turn it on in Settings.")
        case .connecting:
            VStack(spacing: 9) {
                ProgressView().controlSize(.small)
                statusMessage("Connecting live transcript…")
            }
        case .unavailable(let message):
            statusMessage(
                message.isEmpty
                    ? "Live transcription is unavailable. The recording is still safe."
                    : message
            )
        case .idle, .streaming:
            statusMessage("Listening… Speech will appear here as it is transcribed.")
        }
    }

    private func statusMessage(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 12.5, weight: .regular))
            .foregroundStyle(DSColor.Text.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 240)
    }

    private func transcriptEntry(_ entry: RecordingTranscriptPreviewEntry) -> some View {
        Text(entry.text)
            .font(.system(size: 12.5, weight: .regular))
            .lineSpacing(2.5)
            .foregroundStyle(
                entry.isInterim
                    ? DSColor.Text.secondary.opacity(0.76)
                    : DSColor.Text.primary.opacity(0.9)
            )
            .lineLimit(4)
            .padding(.horizontal, 11)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(entryFill(entry))
            )
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(
                        entry.source == .systemAudio
                            ? DSColor.Border.subtle.opacity(0.7)
                            : .clear,
                        lineWidth: 1
                    )
            }
    }

    private func entryFill(_ entry: RecordingTranscriptPreviewEntry) -> Color {
        let base = entry.source == .microphone
            ? DSColor.Bg.subtle.opacity(0.78)
            : DSColor.Bg.canvas.opacity(0.62)
        return entry.isInterim ? base.opacity(0.66) : base
    }

    private var statusColor: Color {
        switch transcription.status {
        case .streaming: return DSColor.State.success
        case .connecting: return DSColor.State.warning
        case .disabled, .idle: return DSColor.Text.tertiary
        case .unavailable: return DSColor.State.danger
        }
    }

    private func scrollToLatest(_ proxy: ScrollViewProxy) {
        guard let id = entries.last?.id else { return }
        DispatchQueue.main.async {
            proxy.scrollTo(id, anchor: .bottom)
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
