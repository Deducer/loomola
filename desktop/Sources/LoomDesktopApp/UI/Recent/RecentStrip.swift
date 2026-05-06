import AppKit
import SwiftUI

/// Recent strip on the idle home view. Renders type-appropriately:
///
/// - Video selected → 3 thumbnail-prominent cards (visual scan).
/// - Audio note selected → all of the user's notes, Granola-style
///   vertical rows grouped by date ("Today", "Yesterday",
///   "Mon May 4", "Apr 30"...). Compact and scannable by title.
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
        HStack(alignment: .top, spacing: DSSpacing.xl) {
            ForEach(filteredItems.prefix(3)) { recording in
                RecentCard(recording: recording) { open(recording: recording) }
            }
            Spacer()
        }
    }

    private var noteList: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            ForEach(RecentDateGrouping.grouped(filteredItems), id: \.label) { group in
                VStack(alignment: .leading, spacing: DSSpacing.xs) {
                    Text(group.label)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                        .padding(.horizontal, DSSpacing.md)
                    VStack(spacing: 0) {
                        ForEach(group.items) { recording in
                            RecentNoteRow(
                                recording: recording,
                                folders: service.folders,
                                onOpen: { open(recording: recording) },
                                onAssignFolder: { newFolderId in
                                    Task {
                                        await service.assignFolder(
                                            recordingId: recording.id,
                                            folderId: newFolderId
                                        )
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var skeleton: some View {
        switch captureMode {
        case .video:
            HStack(spacing: DSSpacing.xl) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .fill(DSColor.Bg.subtle)
                        .frame(width: 320, height: 180)
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
