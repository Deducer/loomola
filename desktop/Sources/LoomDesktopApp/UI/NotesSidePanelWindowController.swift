import AppKit
import Combine
import SwiftUI

/// Granola-shape note workspace. Floats anchored to the right edge
/// of the screen as a portrait NSPanel (~380pt wide × visible height).
///
/// One window, two modes:
///   • RECORDING — auto-summoned when an audio note recording starts.
///     Live notes editor on top, Today/Me/Add-to-folder pills below
///     the title, audio-level + timer + Stop/Pause cluster at bottom.
///   • REVIEWING — opened on demand when the user clicks an audio
///     note in the Recent strip. Same shell, no audio bar; body
///     pre-populated by fetching `GET /api/notes/<id>`.
///
/// `level = .floating + .canJoinAllSpaces + .stationary` so the panel
/// follows the user across spaces (Meet/Zoom often goes fullscreen).
/// `sharingType = .none` so the panel never appears in a screen
/// capture (irrelevant today, consistent with our other floating
/// windows).
@MainActor
final class NotesSidePanelWindowController {
    private var panel: NSPanel?

    /// Show the workspace bound to the supplied target. Idempotent —
    /// passing the same target re-orders front and refreshes content
    /// via the @ObservedObject binding.
    func show(viewModel: RecorderViewModel, target: NoteWorkspaceTarget) {
        let size = Self.preferredSize()
        let panel = panel ?? NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.contentView = NSHostingView(
            rootView: NoteWorkspaceView(
                viewModel: viewModel,
                target: target,
                onClose: { [weak self] in self?.hide() }
            )
        )
        panel.title = ""
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
        panel.minSize = NSSize(width: 360, height: 480)

        if self.panel == nil {
            panel.setFrame(Self.rightEdgeFrame(size: size), display: true)
        }
        panel.makeKeyAndOrderFront(nil)
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
        return NSSize(width: 400, height: max(540, frame.height - 32))
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

/// AI-enhance state machine for the Generate-notes pill in the
/// workspace's review mode. Mirrors the server's
/// `ai_outputs.generation_status` plus an idle default.
enum EnhanceStatus: Equatable {
    case idle
    case running
    case complete
    case failed
}

/// What the workspace is showing. Drives the bottom-bar render and
/// whether the body fetches a saved body on appear.
enum NoteWorkspaceTarget: Equatable {
    /// Active live recording bound to the view-model's recording
    /// state. Title and body pull from `audioTitle` / `liveNotesBody`;
    /// timer + level pull from the recorder. Bottom bar shows
    /// audio-level meter + timer + Pause/Resume + Stop & upload.
    case recording

    /// Reviewing a past recording (clicked from Recent). Body is
    /// fetched from `/api/notes/<id>` on appear; saves go through
    /// the existing PUT autosave pipeline (debounced).
    case reviewing(recording: RecentRecording)
}
