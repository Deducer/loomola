import AppKit
import SwiftUI

/// Granola-style live-notes side panel. Floats anchored to the
/// right edge of the screen during an audio note recording.
/// Contents: editable title, big notes textarea, and a bottom
/// controls bar (recording dot + timer + audio level +
/// Pause/Resume + Stop & upload + ⋯ menu).
///
/// Auto-summons when an audio note recording starts, dismisses
/// when it ends. The panel stays on top across spaces (the user
/// might switch to a meeting tab and need the notes to follow).
/// `sharingType = .none` so the panel never appears in any concurrent
/// screen capture (no current consumer for that, but consistent
/// with the rest of our floating windows).
@MainActor
final class NotesSidePanelWindowController {
    private var panel: NSPanel?

    /// Show or update the side panel for the active audio recording.
    /// Idempotent: calling repeatedly with the same view-model just
    /// re-orders the panel front and refreshes content via the
    /// @ObservedObject binding.
    func show(viewModel: RecorderViewModel) {
        let size = Self.preferredSize()
        let panel = panel ?? NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .resizable, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        if panel.contentView == nil {
            panel.contentView = NSHostingView(rootView: NotesSidePanelView(viewModel: viewModel))
        }
        panel.title = "Notes"
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .stationary,
        ]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.sharingType = .none
        panel.isReleasedWhenClosed = false
        panel.minSize = NSSize(width: 320, height: 420)

        if self.panel == nil {
            // First show: position at top-right of the visible frame.
            panel.setFrame(Self.rightEdgeFrame(size: size), display: true)
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

    private static func preferredSize() -> NSSize {
        let frame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        // ~360pt wide (Granola footprint) by full visible height.
        return NSSize(width: 380, height: max(540, frame.height - 32))
    }

    private static func rightEdgeFrame(size: NSSize) -> NSRect {
        let frame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSRect(
            x: frame.maxX - size.width - 16,
            y: frame.maxY - size.height - 16,
            width: size.width,
            height: size.height
        )
    }
}

/// SwiftUI body of the notes side panel. Backed by the recorder
/// view model — bindings flow live, so pause/resume + audio level
/// + timer all update without explicit refresh.
private struct NotesSidePanelView: View {
    @ObservedObject var viewModel: RecorderViewModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(DSColor.Border.subtle)
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    titleField
                    notesEditor
                }
                .padding(DSSpacing.xl)
            }
            Spacer(minLength: 0)
            Divider().overlay(DSColor.Border.subtle)
            controlBar
        }
        .background(DSColor.Bg.surface)
    }

    private var header: some View {
        HStack(spacing: DSSpacing.sm) {
            BrandLogoMark(size: 22)
            Text("Live notes")
                .font(DSFont.Body.lg())
                .foregroundStyle(DSColor.Text.primary)
            Spacer()
            // No close button — the panel auto-dismisses when the
            // recording stops. Closing mid-recording would orphan
            // the recording with no UI to control it.
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, DSSpacing.md)
    }

    private var titleField: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text("Title")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
            TextField("Untitled note", text: $viewModel.audioTitle)
                .textFieldStyle(.plain)
                .font(DSFont.Display.lg())
                .foregroundStyle(DSColor.Text.primary)
        }
    }

    private var notesEditor: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text("Notes")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
            // SwiftUI's TextEditor is the right primitive for a
            // multi-line, growable note pad. We don't constrain
            // height — the ScrollView in the parent body handles
            // overflow.
            TextEditor(text: $viewModel.liveNotesBody)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .scrollContentBackground(.hidden)
                .background(DSColor.Bg.subtle, in: RoundedRectangle(cornerRadius: DSRadius.md))
                .frame(minHeight: 320)
                .overlay(alignment: .topLeading) {
                    if viewModel.liveNotesBody.isEmpty {
                        Text("Jot live notes here. They'll attach to this recording on stop.")
                            .font(DSFont.Body.md())
                            .foregroundStyle(DSColor.Text.tertiary)
                            .padding(.horizontal, DSSpacing.md)
                            .padding(.vertical, DSSpacing.sm + 2)
                            .allowsHitTesting(false)
                    }
                }
        }
    }

    private var controlBar: some View {
        HStack(spacing: DSSpacing.md) {
            stateIndicator
            Spacer()
            controls
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, DSSpacing.md)
    }

    private var stateIndicator: some View {
        HStack(spacing: DSSpacing.sm) {
            Circle()
                .fill(viewModel.isAudioNotePaused
                    ? DSColor.State.warning
                    : DSColor.State.recording)
                .frame(width: 8, height: 8)
            Text(viewModel.isAudioNotePaused ? "Paused" : "Recording")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
            if let startedAt = viewModel.activeAudioRecordingStartedAt {
                if viewModel.isAudioNotePaused {
                    Text("—")
                        .font(DSFont.Mono.body())
                        .foregroundStyle(DSColor.Text.tertiary)
                } else {
                    TimelineView(.periodic(from: startedAt, by: 1)) { ctx in
                        Text(elapsedString(now: ctx.date, startedAt: startedAt))
                            .font(DSFont.Mono.body())
                            .foregroundStyle(DSColor.Text.tertiary)
                    }
                }
            }
        }
    }

    private var controls: some View {
        HStack(spacing: DSSpacing.sm) {
            if viewModel.isAudioNotePaused {
                SecondaryButton("Resume", icon: "play.fill") {
                    viewModel.resumeAudioNoteRecording()
                }
            } else {
                SecondaryButton("Pause", icon: "pause.fill") {
                    viewModel.pauseAudioNoteRecording()
                }
            }
            PrimaryButton("Stop & upload", icon: "stop.fill", kind: .destructive) {
                viewModel.stopAudioNoteRecordingAndUpload()
            }
            Menu {
                Button("Discard recording", role: .destructive) {
                    viewModel.cancelAudioNoteRecording()
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 32, height: 32)
                    .foregroundStyle(DSColor.Text.secondary)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(width: 32)
        }
    }

    private func elapsedString(now: Date, startedAt: Date) -> String {
        let total = max(0, Int(now.timeIntervalSince(startedAt)))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }
}
