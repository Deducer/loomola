import AppKit
import SwiftUI

/// Granola-shape note workspace. Lives inside the right-anchored
/// NSPanel hosted by `NotesSidePanelWindowController`.
///
/// Layout (top to bottom):
///   - Custom title strip: Home/Back button (left) + ⋯ menu (right)
///   - Big serif title (editable in recording mode, display-only in
///     review mode)
///   - Three meta pills: Today (calendar event), Me (attendees),
///     Add to folder
///   - Markdown body (TextEditor, large)
///   - Bottom controls (recording mode only): mini level-meter +
///     timer + Pause/Resume + Stop & upload
///
/// The transcription-drawer expansion (Granola's chevron-next-to-
/// waveform) is intentionally deferred — it requires Deepgram
/// streaming, which we don't currently use (we batch-transcribe
/// after upload). Rendered as a placeholder hint; tracked as a
/// follow-up.
struct NoteWorkspaceView: View {
    @ObservedObject var viewModel: RecorderViewModel
    let target: NoteWorkspaceTarget
    let onClose: () -> Void

    /// Local body editor state for review mode (we fetch from
    /// `/api/notes/<id>` on appear; debounced autosave persists).
    @State private var reviewBody: String = ""
    @State private var reviewTitle: String = ""
    @State private var reviewFolderId: String? = nil
    @State private var reviewFolderName: String? = nil
    @State private var reviewAutosaveTask: Task<Void, Never>? = nil
    @State private var reviewLastSaved: String = ""
    @State private var showFolderPicker = false
    @State private var showRowMenu = false
    @State private var loadingBody = false

    private var isRecording: Bool {
        if case .recording = target { return true }
        return false
    }

    /// Title bound to the right state container depending on mode.
    private var titleBinding: Binding<String> {
        switch target {
        case .recording:
            return $viewModel.audioTitle
        case .reviewing:
            return $reviewTitle
        }
    }

    /// Body bound to the right state container depending on mode.
    private var bodyBinding: Binding<String> {
        switch target {
        case .recording:
            return $viewModel.liveNotesBody
        case .reviewing:
            return $reviewBody
        }
    }

    /// Folder fields read from view-model (recording) or local
    /// state (review).
    private var folderId: String? {
        switch target {
        case .recording: return nil  // Not yet wired during recording.
        case .reviewing: return reviewFolderId
        }
    }

    private var folderName: String? {
        switch target {
        case .recording: return nil
        case .reviewing: return reviewFolderName
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            titleBar
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    titleEditor
                    pillRow
                    bodyEditor
                }
                .padding(.horizontal, DSSpacing.xl)
                .padding(.top, DSSpacing.md)
                .padding(.bottom, DSSpacing.xxl)
            }
            if isRecording {
                Divider().overlay(DSColor.Border.subtle)
                recordingControlBar
            }
        }
        .background(DSColor.Bg.canvas)
        .onAppear { handleAppear() }
        .onDisappear {
            reviewAutosaveTask?.cancel()
        }
        .onChange(of: reviewBody) { _, newValue in
            scheduleReviewAutosave(newValue)
        }
    }

    // MARK: - Title bar

    private var titleBar: some View {
        HStack(spacing: 0) {
            // 78pt traffic-light spacer (matches CustomTitleBar).
            Spacer().frame(width: 78)
            IconButton(
                icon: "chevron.left",
                size: 26,
                action: onClose
            )
            .help(isRecording ? "Hide while recording (panel reappears on next event)" : "Close")
            Spacer()
            IconButton(
                icon: "ellipsis",
                size: 26,
                action: { showRowMenu.toggle() }
            )
            .popover(isPresented: $showRowMenu, arrowEdge: .top) {
                rowMenu
            }
            .padding(.trailing, DSSpacing.md)
        }
        .frame(height: 40)
    }

    private var rowMenu: some View {
        VStack(alignment: .leading, spacing: 0) {
            menuItem(label: "Copy text", icon: "doc.on.doc", tint: DSColor.Text.primary) {
                showRowMenu = false
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(currentBody, forType: .string)
            }
            menuItem(label: "Open on web", icon: "arrow.up.right.square", tint: DSColor.Text.primary) {
                showRowMenu = false
                if case .reviewing(let recording) = target,
                   let url = URL(string: "https://loom.dissonance.cloud/notes/\(recording.slug)") {
                    NSWorkspace.shared.open(url)
                }
            }
            if case .reviewing = target {
                Divider().overlay(DSColor.Border.subtle)
                menuItem(label: "Move to trash", icon: "trash", tint: DSColor.State.danger) {
                    showRowMenu = false
                    if case .reviewing(let recording) = target {
                        Task {
                            await viewModel.recentRecordings.bulkDelete(ids: [recording.id])
                            onClose()
                        }
                    }
                }
            }
        }
        .frame(width: 200)
        .background(DSColor.Bg.surfaceRaised)
    }

    private func menuItem(
        label: String,
        icon: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        WorkspaceMenuItem(label: label, icon: icon, tint: tint, action: action)
    }

    private var currentBody: String {
        switch target {
        case .recording: return viewModel.liveNotesBody
        case .reviewing: return reviewBody
        }
    }

    // MARK: - Title

    private var titleEditor: some View {
        TextField(titlePlaceholder, text: titleBinding)
            .textFieldStyle(.plain)
            .font(DSFont.Display.xl())
            .foregroundStyle(DSColor.Text.primary)
            .tint(DSColor.Accent.primary)
            .disabled(!isTitleEditable)
    }

    private var titlePlaceholder: String {
        switch target {
        case .recording: return "New note"
        case .reviewing: return reviewTitle.isEmpty ? "Untitled" : ""
        }
    }

    private var isTitleEditable: Bool {
        // Title editable during recording (synced via PUT) and
        // during review (TODO: wire title PUT — for now read-only
        // in review).
        switch target {
        case .recording: return true
        case .reviewing: return false
        }
    }

    // MARK: - Pill row

    private var pillRow: some View {
        HStack(spacing: DSSpacing.sm) {
            todayPill
            mePill
            folderPill
        }
    }

    private var todayPill: some View {
        WorkspacePill(
            icon: "calendar",
            label: "Today",
            isActive: false,
            action: { /* deferred — calendar integration */ }
        )
        .help("Calendar linking coming soon")
    }

    private var mePill: some View {
        WorkspacePill(
            icon: "person.2",
            label: "Me",
            isActive: false,
            action: { /* deferred — attendees admin UI */ }
        )
        .help("Attendees admin coming soon")
    }

    @ViewBuilder
    private var folderPill: some View {
        WorkspacePill(
            icon: folderId == nil ? "folder.badge.plus" : "folder",
            label: folderName ?? "Add to folder",
            isActive: folderId != nil,
            action: { showFolderPicker.toggle() }
        )
        .popover(isPresented: $showFolderPicker, arrowEdge: .top) {
            FolderPickerPopover(
                folders: viewModel.recentRecordings.folders,
                selectedFolderId: folderId,
                onSelect: { newFolderId in
                    showFolderPicker = false
                    handleFolderSelect(folderId: newFolderId)
                },
                onCreate: { name in
                    do {
                        return try await viewModel.recentRecordings.createFolder(name: name)
                    } catch {
                        return nil
                    }
                }
            )
        }
    }

    private func handleFolderSelect(folderId newFolderId: String?) {
        switch target {
        case .recording:
            // The active recording's media-object id is on the
            // view model; reuse the existing assignFolder path.
            if let recordingId = viewModel.activeAudioRecordingId {
                Task {
                    await viewModel.recentRecordings.assignFolder(
                        recordingId: recordingId,
                        folderId: newFolderId
                    )
                }
            }
        case .reviewing(let recording):
            // Optimistic local update + service-level update so
            // the Recent strip's pill reflects the change.
            reviewFolderId = newFolderId
            reviewFolderName = newFolderId.flatMap { id in
                viewModel.recentRecordings.folders.first(where: { $0.id == id })?.name
            }
            Task {
                await viewModel.recentRecordings.assignFolder(
                    recordingId: recording.id,
                    folderId: newFolderId
                )
            }
        }
    }

    // MARK: - Body

    private var bodyEditor: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: bodyBinding)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .scrollContentBackground(.hidden)
                .background(Color.clear)
                .frame(minHeight: 320)
                .tint(DSColor.Accent.primary)
            if bodyBinding.wrappedValue.isEmpty && !loadingBody {
                Text("Write notes")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .padding(.top, 8)
                    .padding(.leading, 4)
                    .allowsHitTesting(false)
            }
            if loadingBody {
                Text("Loading…")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .padding(.top, 8)
                    .padding(.leading, 4)
                    .allowsHitTesting(false)
            }
        }
    }

    // MARK: - Recording control bar (recording mode only)

    private var recordingControlBar: some View {
        HStack(spacing: DSSpacing.md) {
            // Mini live audio level meter, 4 bars. Reads
            // `viewModel.audioLevel`. Granola shows an actual
            // waveform; bars are a close-enough proxy for v1.
            HStack(alignment: .center, spacing: 2) {
                ForEach(0..<4) { i in
                    let threshold = Double(i + 1) * 0.25
                    let active = viewModel.audioLevel >= threshold * 0.8
                    RoundedRectangle(cornerRadius: 1)
                        .fill(active ? DSColor.Accent.primary : DSColor.Bg.subtle)
                        .frame(width: 3, height: 10 + CGFloat(i) * 2)
                }
            }
            .frame(width: 28)

            // Timer.
            if let startedAt = viewModel.activeAudioRecordingStartedAt {
                TimelineView(.periodic(from: startedAt, by: 1)) { ctx in
                    Text(elapsedString(now: ctx.date, startedAt: startedAt))
                        .font(DSFont.Mono.body())
                        .foregroundStyle(DSColor.Text.secondary)
                }
            }

            Spacer()

            // Pause/Resume was reverted in 259f909 due to PTS
            // rewrite crashes. When that lands cleanly, restore
            // an icon-button trio (Pause/Resume + Stop) here.

            // Stop & upload — primary destructive button.
            Button {
                viewModel.stopAudioNoteRecordingAndUpload()
            } label: {
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(.white)
                        .frame(width: 9, height: 9)
                    Text("Stop")
                        .font(DSFont.Body.sm())
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, 6)
                .foregroundStyle(.white)
                .background(
                    Capsule().fill(DSColor.State.recording)
                )
            }
            .buttonStyle(.plain)
            .help("Stop & upload")
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, DSSpacing.sm)
    }

    // MARK: - Lifecycle

    private func handleAppear() {
        switch target {
        case .recording:
            break
        case .reviewing(let recording):
            reviewTitle = recording.title
            reviewFolderId = recording.folderId
            reviewFolderName = recording.folderName
            reviewBody = ""
            loadingBody = true
            Task {
                if let backend = viewModel.backendClient {
                    do {
                        let body = try await backend.getNoteBody(mediaId: recording.id)
                        await MainActor.run {
                            reviewBody = body
                            reviewLastSaved = body
                            loadingBody = false
                        }
                    } catch {
                        await MainActor.run {
                            loadingBody = false
                        }
                    }
                }
            }
        }
    }

    private func scheduleReviewAutosave(_ next: String) {
        guard case .reviewing(let recording) = target else { return }
        guard !loadingBody else { return }
        guard next != reviewLastSaved else { return }
        reviewAutosaveTask?.cancel()
        reviewAutosaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled else { return }
            guard let backend = viewModel.backendClient else { return }
            do {
                try await backend.putNoteBody(mediaId: recording.id, body: next)
                reviewLastSaved = next
            } catch {
                // Surface failure silently for v1; real toast wiring
                // is a polish follow-up. The next typing event will
                // reschedule a save.
            }
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

// MARK: - Pill component

private struct WorkspacePill: View {
    let icon: String
    let label: String
    let isActive: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(isActive ? DSColor.Text.primary : DSColor.Text.tertiary)
            Text(label)
                .font(DSFont.Body.sm())
                .foregroundStyle(isActive ? DSColor.Text.primary : DSColor.Text.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, DSSpacing.sm)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill(hovering ? DSColor.Bg.subtle : Color.clear)
        )
        .overlay {
            Capsule()
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
        .contentShape(Capsule())
        .overlay { ActionHitArea(action: action) }
        .onHover { hovering = $0 }
        .animation(LoomolaMotion.quick, value: hovering)
    }
}

// MARK: - Menu item

private struct WorkspaceMenuItem: View {
    let label: String
    let icon: String
    let tint: Color
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 16)
            Text(label)
                .font(DSFont.Body.md())
                .foregroundStyle(tint)
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(hovering ? DSColor.Bg.subtle : Color.clear)
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: action) }
        .onHover { hovering = $0 }
    }
}
