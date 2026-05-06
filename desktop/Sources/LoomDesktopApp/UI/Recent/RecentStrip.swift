import AppKit
import SwiftUI

/// Recent strip on the idle home view. Renders type-appropriately:
///
/// - When the user has Video selected, shows a horizontal grid of
///   thumbnail-prominent cards (video is something you scan
///   visually).
/// - When the user has Audio note selected, shows a Granola-style
///   vertical list of compact rows (audio is something you scan by
///   title — the auto-generated waveform PNG carries no signal).
///
/// Filters the underlying service's items by `kind` so each mode
/// only shows its own type.
struct RecentStrip: View {
    @ObservedObject var service: RecentRecordingsService
    let captureMode: CaptureMode

    private var filteredItems: [RecentRecording] {
        let target: RecentRecording.Kind = (captureMode == .video) ? .video : .audio
        return service.items.filter { $0.kind == target }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            HStack(alignment: .firstTextBaseline) {
                Text(headerTitle)
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Spacer()
                if !filteredItems.isEmpty {
                    Text("View all")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Accent.primary)
                        .contentShape(Rectangle())
                        .overlay { ActionHitArea(action: openLibrary) }
                }
            }

            content
        }
        .onAppear {
            if service.items.isEmpty {
                service.refresh()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !service.hasLoaded {
            skeleton
        } else if filteredItems.isEmpty {
            emptyState
        } else {
            switch captureMode {
            case .video: videoGrid
            case .audio: noteList
            }
        }
    }

    private var videoGrid: some View {
        HStack(alignment: .top, spacing: DSSpacing.lg) {
            ForEach(filteredItems.prefix(4)) { recording in
                RecentCard(recording: recording) { open(recording: recording) }
            }
            Spacer()
        }
    }

    private var noteList: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(filteredItems.prefix(6)) { recording in
                RecentNoteRow(recording: recording) { open(recording: recording) }
            }
        }
    }

    @ViewBuilder
    private var skeleton: some View {
        switch captureMode {
        case .video:
            HStack(spacing: DSSpacing.lg) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .fill(DSColor.Bg.subtle)
                        .frame(width: 220, height: 168)
                }
                Spacer()
            }
        case .audio:
            VStack(spacing: 8) {
                ForEach(0..<5, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: DSRadius.sm)
                        .fill(DSColor.Bg.subtle)
                        .frame(height: 44)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: DSSpacing.md) {
            Image(systemName: emptyIcon)
                .font(.system(size: 42, weight: .light))
                .foregroundStyle(DSColor.Text.tertiary)
            Text(emptyTitle)
                .font(DSFont.Body.lg())
                .foregroundStyle(DSColor.Text.secondary)
            Text(emptySubtitle)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DSSpacing.xxl)
    }

    private var headerTitle: String {
        switch captureMode {
        case .video: return "Recent recordings"
        case .audio: return "Recent notes"
        }
    }

    private var emptyIcon: String {
        switch captureMode {
        case .video: return "video"
        case .audio: return "waveform.path.ecg.rectangle"
        }
    }

    private var emptyTitle: String {
        switch captureMode {
        case .video: return "No recordings yet."
        case .audio: return "No notes yet."
        }
    }

    private var emptySubtitle: String {
        switch captureMode {
        case .video: return "Hit Start recording or press ⌥⇧R to begin."
        case .audio: return "Hit Start audio note to capture a meeting."
        }
    }

    private func open(recording: RecentRecording) {
        let path = recording.kind == .audio ? "/notes/\(recording.slug)" : "/v/\(recording.slug)"
        if let url = URL(string: "https://loom.dissonance.cloud" + path) {
            NSWorkspace.shared.open(url)
        }
    }

    private func openLibrary() {
        if let url = URL(string: "https://loom.dissonance.cloud") {
            NSWorkspace.shared.open(url)
        }
    }
}
