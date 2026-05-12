import AppKit
import SwiftUI

/// Recent strip on the idle home view. Renders type-appropriately:
///
/// - Video selected → 3 thumbnail-prominent cards (visual scan).
/// - Audio note selected → all of the user's notes, Granola-style
///   vertical rows grouped by date (Today / Yesterday / Mon, May 4 /
///   Apr 28 / Dec 12, 2025). Compact and scannable by title.
///
/// Audio rows support per-row hover ⋯ menu (Move to folder /
/// Delete) and bulk-select via a hover-revealed checkbox; ticking
/// any checkbox surfaces Move / Delete / Cancel actions in the
/// header, matching the web app's visible bulk-action pattern.
struct RecentStrip: View {
    @ObservedObject var service: RecentRecordingsService
    let captureMode: CaptureMode
    /// When set, filters the strip to recordings filed in that
    /// folder. Driven by the sidebar's space selection. Nil = "all"
    /// (the default Home view).
    let folderFilterId: String?
    /// Display name of the folder filter, when active. Nil if no
    /// filter or if the folder isn't in the service's loaded list.
    let activeFolderName: String?
    /// Callback invoked when the user clicks the "✕" on the active
    /// folder header — clears the filter back to all.
    let onClearFolderFilter: () -> Void
    /// Callback invoked when the user clicks an audio note row.
    /// The host (MainRecorderView) opens the desktop-native note
    /// workspace for the recording. Video rows still go to the
    /// browser (sharing-driven).
    let onOpenAudioNote: (RecentRecording) -> Void

    /// Set of selected note IDs across the visible rows. Living on
    /// the strip (not the service) so it resets when the user
    /// switches capture modes or the strip rebuilds; bulk operations
    /// invoke the service.
    @State private var selectedIds: Set<String> = []
    @State private var showBulkPicker = false
    @State private var showDeleteConfirm = false

    private var filteredItems: [RecentRecording] {
        let target: RecentRecording.Kind = (captureMode == .video) ? .video : .audio
        let kindFiltered = service.items.filter { $0.kind == target }
        if let folderFilterId {
            return kindFiltered.filter { $0.folderId == folderFilterId }
        }
        return kindFiltered
    }

    private var selectedRecordings: [RecentRecording] {
        filteredItems.filter { selectedIds.contains($0.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            HStack(alignment: .firstTextBaseline, spacing: DSSpacing.sm) {
                Text(headerTitle)
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                if activeFolderName != nil {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(DSColor.Text.tertiary)
                    }
                    .padding(6)
                    .background(
                        Circle().fill(DSColor.Bg.subtle)
                    )
                    .contentShape(Circle())
                    .overlay { ActionHitArea(action: onClearFolderFilter) }
                    .help("Show all")
                }
                Spacer()
                if !selectedIds.isEmpty {
                    bulkHeaderActions
                } else if !filteredItems.isEmpty && captureMode == .video {
                    Text("View all")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Accent.primary)
                        .contentShape(Rectangle())
                        .overlay { ActionHitArea(action: openLibrary) }
                }
            }

            content
        }
        .animation(LoomolaMotion.quick, value: selectedIds.isEmpty)
        .onChange(of: captureMode) { _, _ in
            // Switching modes drops any in-progress selection — the
            // checkboxes belong to one mode at a time.
            selectedIds.removeAll()
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
            ForEach(filteredItems.prefix(3)) { recording in
                RecentCard(
                    recording: recording,
                    folders: service.folders,
                    isSelected: selectedIds.contains(recording.id),
                    selectionActive: !selectedIds.isEmpty,
                    onOpen: { open(recording: recording) },
                    onToggleSelected: { toggleSelected(recording.id) },
                    onAssignFolder: { newFolderId in
                        Task {
                            await service.assignFolder(
                                recordingId: recording.id,
                                folderId: newFolderId
                            )
                        }
                    },
                    onCreateFolder: { name in
                        do {
                            let folder = try await service.createFolder(name: name)
                            await service.assignFolder(
                                recordingId: recording.id,
                                folderId: folder.id
                            )
                            return folder
                        } catch {
                            return nil
                        }
                    },
                    onDelete: {
                        Task {
                            await service.bulkDelete(ids: [recording.id])
                        }
                    },
                    onCopyLink: { copyShareLink(recording) }
                )
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
                                isSelected: selectedIds.contains(recording.id),
                                selectionActive: !selectedIds.isEmpty,
                                onOpen: { open(recording: recording) },
                                onToggleSelected: { toggleSelected(recording.id) },
                                onAssignFolder: { newFolderId in
                                    Task {
                                        await service.assignFolder(
                                            recordingId: recording.id,
                                            folderId: newFolderId
                                        )
                                    }
                                },
                                onCreateFolder: { name in
                                    do {
                                        let folder = try await service.createFolder(name: name)
                                        await service.assignFolder(
                                            recordingId: recording.id,
                                            folderId: folder.id
                                        )
                                        return folder
                                    } catch {
                                        return nil
                                    }
                                },
                                onDelete: {
                                    Task {
                                        await service.bulkDelete(ids: [recording.id])
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }
    }

    private func toggleSelected(_ id: String) {
        if selectedIds.contains(id) {
            selectedIds.remove(id)
        } else {
            selectedIds.insert(id)
        }
    }

    // MARK: - Bulk actions

    private var bulkHeaderActions: some View {
        HStack(spacing: DSSpacing.sm) {
            Text("\(selectedIds.count) selected")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)

            if selectedIds.count < filteredItems.count {
                Button {
                    selectedIds = Set(filteredItems.map(\.id))
                } label: {
                    Text("Select all")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Accent.primary)
                }
                .buttonStyle(.plain)
            }

            Button {
                showBulkPicker = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "folder")
                        .font(.system(size: 11, weight: .medium))
                    Text("Move")
                        .font(DSFont.Body.sm())
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: DSRadius.sm)
                        .fill(DSColor.Bg.surface)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: DSRadius.sm)
                        .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
                }
                .foregroundStyle(DSColor.Text.primary)
            }
            .buttonStyle(.plain)
            .popover(isPresented: $showBulkPicker, arrowEdge: .bottom) {
                FolderPickerPopover(
                    folders: service.folders,
                    selectedFolderId: nil,
                    onSelect: { folderId in
                        showBulkPicker = false
                        let ids = Array(selectedIds)
                        Task {
                            for id in ids {
                                await service.assignFolder(recordingId: id, folderId: folderId)
                            }
                            selectedIds.removeAll()
                        }
                    },
                    onCreate: { name in
                        try? await service.createFolder(name: name)
                    }
                )
            }

            Button {
                showDeleteConfirm = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "trash")
                        .font(.system(size: 11, weight: .medium))
                    Text("Delete")
                        .font(DSFont.Body.sm())
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: DSRadius.sm)
                        .fill(DSColor.State.danger.opacity(0.08))
                )
                .overlay {
                    RoundedRectangle(cornerRadius: DSRadius.sm)
                        .strokeBorder(DSColor.State.danger.opacity(0.4), lineWidth: 1)
                }
                .foregroundStyle(DSColor.State.danger)
            }
            .buttonStyle(.plain)
            .alert("Delete \(selectedIds.count) \(selectedKindName)\(selectedIds.count == 1 ? "" : "s")?", isPresented: $showDeleteConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    let ids = selectedIds
                    Task {
                        await service.bulkDelete(ids: ids)
                        selectedIds.removeAll()
                    }
                }
            } message: {
                Text("This can't be undone from the desktop app. You can recover via the dashboard's trash within 30 days.")
            }

            Button {
                selectedIds.removeAll()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .padding(8)
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, DSSpacing.sm)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md)
                .fill(DSColor.Bg.surfaceRaised)
        )
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.md)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
        .dsShadow(.raised)
    }

    // MARK: - Skeleton + empty + nav

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
        if let activeFolderName {
            return activeFolderName
        }
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

    private var selectedKindName: String {
        switch captureMode {
        case .video: return "recording"
        case .audio: return "note"
        }
    }

    private func open(recording: RecentRecording) {
        switch recording.kind {
        case .audio:
            // Audio notes open in the desktop-native workspace.
            // The user's daily-driver flow stays in-app.
            onOpenAudioNote(recording)
        case .video:
            // Video Looms open in the browser. The share page IS
            // the canonical viewer (visitors can't have the desktop
            // app), so duplicating it locally would just route the
            // user to the browser anyway when they want to share.
            if let url = URL(string: "https://loom.dissonance.cloud/v/\(recording.slug)") {
                NSWorkspace.shared.open(url)
            }
        }
    }

    private func openLibrary() {
        if let url = URL(string: "https://loom.dissonance.cloud") {
            NSWorkspace.shared.open(url)
        }
    }

    private func copyShareLink(_ recording: RecentRecording) {
        guard let url = URL(string: "https://loom.dissonance.cloud/v/\(recording.slug)") else {
            return
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(url.absoluteString, forType: .string)
    }
}
