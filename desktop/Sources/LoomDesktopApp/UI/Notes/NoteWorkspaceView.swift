import AppKit
import SwiftUI
import UniformTypeIdentifiers

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
    @FocusState private var bodyFocused: Bool

    /// Image attachments associated with the note. Populated from
    /// `/api/notes/<id>/attachments` on appear (review mode) and
    /// extended by drag-and-drop uploads.
    @State private var attachments: [NoteAttachmentDTO] = []
    /// True while the user is dragging file(s) over the body —
    /// drives the centered "Attach images" overlay.
    @State private var isDropTargeted = false
    /// Number of in-flight uploads. Drives the "still processing"
    /// state on attachment thumbnails.
    @State private var uploadingCount = 0
    /// Bottom-anchored toast that fades in/out on successful
    /// attachment.
    @State private var toastMessage: String? = nil

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

    /// Backing media-object id (also the noteId) for whichever
    /// note this workspace is showing. Used by attachment uploads.
    private var noteId: String? {
        switch target {
        case .recording: return viewModel.activeAudioRecordingId
        case .reviewing(let recording): return recording.id
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
                .padding(.top, 8)
                .padding(.bottom, DSSpacing.xxl)
            }
            // Drag images anywhere over the editor area. Whole-body
            // drop target — no precise hit zone needed (Granola
            // accepts drops over the entire note workspace).
            .onDrop(of: [.fileURL, .image], isTargeted: $isDropTargeted) { providers in
                handleDrop(providers: providers)
            }
            .overlay {
                if isDropTargeted {
                    dropTargetOverlay
                        .transition(.opacity)
                }
            }

            // Attachments strip pinned to the bottom of the
            // workspace, above the recording control bar. Keeps
            // images out of the title/body area so they never
            // distract from the user's typing flow. Granola pattern.
            if !attachments.isEmpty || uploadingCount > 0 {
                attachmentsStrip
                    .padding(.horizontal, DSSpacing.xl)
                    .padding(.top, DSSpacing.sm)
                    .padding(.bottom, isRecording ? DSSpacing.sm : DSSpacing.lg)
            }

            if isRecording {
                // No divider — Granola's restraint pattern.
                recordingControlBar
                    .padding(.horizontal, DSSpacing.lg)
                    .padding(.bottom, DSSpacing.lg)
            }
        }
        .background(DSColor.Bg.canvas)
        .overlay(alignment: .bottom) {
            if let toastMessage {
                attachmentToast(message: toastMessage)
                    .padding(.bottom, isRecording ? 80 : DSSpacing.xl)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(LoomolaMotion.quick, value: isDropTargeted)
        .animation(LoomolaMotion.medium, value: toastMessage)
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
        // Inline with the macOS traffic lights. `fullSizeContentView`
        // lets our content draw under the title chrome at y=0; the
        // traffic lights overlay at their standard position (vertical
        // center ~y=13). 28pt frame with no top padding centers our
        // buttons at the same y, eliminating the wasted vertical band.
        HStack(spacing: 0) {
            // 78pt traffic-light spacer.
            Spacer().frame(width: 78)
            HomeBackButton(action: onClose)
                .help(isRecording ? "Hide (panel reappears on next event)" : "Close")
            Spacer()
            GhostEllipsisButton {
                showRowMenu.toggle()
            }
            .popover(isPresented: $showRowMenu, arrowEdge: .top) {
                rowMenu
            }
            .padding(.trailing, DSSpacing.md)
        }
        .frame(height: 28)
    }

    private var rowMenu: some View {
        VStack(alignment: .leading, spacing: 0) {
            menuItem(label: "Copy text", icon: "doc.on.doc", tint: DSColor.Text.primary) {
                showRowMenu = false
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(currentBody, forType: .string)
            }
            if case .reviewing = target {
                menuItem(label: "Open on web", icon: "arrow.up.right.square", tint: DSColor.Text.primary) {
                    showRowMenu = false
                    if case .reviewing(let recording) = target,
                       let url = URL(string: "https://loom.dissonance.cloud/notes/\(recording.slug)") {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
            if isRecording {
                Divider().overlay(DSColor.Border.subtle)
                // Granola pattern: Discard is a destructive action
                // that doesn't compete with the prominent Stop pill —
                // tucked in the ⋯ menu, one click away.
                menuItem(label: "Discard recording", icon: "trash", tint: DSColor.State.danger) {
                    showRowMenu = false
                    viewModel.cancelAudioNoteRecording()
                    onClose()
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
        .frame(width: 220)
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
            MarkdownTextEditor(
                text: bodyBinding,
                placeholder: loadingBody ? "Loading…" : "Write notes",
                isFocused: $bodyFocused
            )
            .frame(minHeight: 320)
            // Pull 5pt back to compensate for NSTextView's internal
            // text container inset so the heading text origin lines
            // up with the title row above.
            .padding(.leading, -5)
        }
    }

    // MARK: - Recording control bar (recording mode only)

    /// Single grouped pill: [meter] [▾] | [timer] | [stop]. The
    /// recording's audio source, timer, and stop affordance share
    /// one container so they read as one unit — stop the thing
    /// that's being indicated by the meter and timer next to it.
    /// Granola's larger, more conspicuous shape with restraint
    /// (no surrounding divider).
    private var recordingControlBar: some View {
        HStack(spacing: 0) {
            // Meter + chevron (transcription drawer placeholder).
            HStack(spacing: 8) {
                AudioLevelMeter(level: viewModel.audioLevel)
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            .padding(.leading, 14)
            .padding(.trailing, 12)

            pillSeparator

            // Timer.
            if let startedAt = viewModel.activeAudioRecordingStartedAt {
                TimelineView(.periodic(from: startedAt, by: 1)) { ctx in
                    Text(elapsedString(now: ctx.date, startedAt: startedAt))
                        .font(DSFont.Mono.body())
                        .foregroundStyle(DSColor.Text.secondary)
                        .monospacedDigit()
                }
                .padding(.horizontal, 14)
            }

            pillSeparator

            // Stop. Inline inside the pill rather than a sibling pill.
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(DSColor.State.recording)
                    .frame(width: 12, height: 12)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
            .overlay {
                ActionHitArea {
                    viewModel.stopAudioNoteRecordingAndUpload()
                }
            }
            .help("Stop & upload")
        }
        .background(
            Capsule().fill(DSColor.Bg.surface)
        )
        .overlay {
            Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
        .frame(height: 44)
        .frame(maxWidth: .infinity)
    }

    private var pillSeparator: some View {
        Rectangle()
            .fill(DSColor.Border.subtle)
            .frame(width: 1, height: 24)
    }

    // MARK: - Lifecycle

    // MARK: - Drop target overlay

    /// Granola-shape "Attach images" overlay that appears while the
    /// user is dragging a file over the body. Centered camera-stack
    /// glyph with a headline + subhead beneath.
    private var dropTargetOverlay: some View {
        ZStack {
            DSColor.Bg.canvas.opacity(0.92)
                .ignoresSafeArea()
            VStack(spacing: DSSpacing.sm) {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: 56, weight: .light))
                    .foregroundStyle(DSColor.Text.tertiary)
                    .padding(.bottom, 4)
                Text("Attach images")
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text("Enhance your notes with visual context")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.secondary)
            }
        }
    }

    // MARK: - Attachments strip

    /// Bottom-of-body row showing attached image thumbnails plus a
    /// "Attached images" header. Granola pattern: a small paperclip
    /// glyph + label, then a row of 64×48 rounded thumbs that
    /// expand to a preview on click (preview is a future polish).
    private var attachmentsStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Image(systemName: "paperclip")
                    .font(.system(size: 11, weight: .medium))
                Text("Attached images")
                    .font(DSFont.Body.sm())
            }
            .foregroundStyle(DSColor.Text.secondary)

            HStack(spacing: 8) {
                ForEach(attachments) { attachment in
                    AttachmentThumbnail(attachment: attachment)
                }
                if uploadingCount > 0 {
                    UploadingThumbnailPlaceholder()
                }
                Spacer()
            }
        }
        .padding(.top, DSSpacing.md)
    }

    // MARK: - Toast

    /// Bottom-anchored confirmation pill. Auto-dismisses after ~2.5s.
    private func attachmentToast(message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(DSColor.State.success)
            Text(message)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, 10)
        .background(
            Capsule().fill(DSColor.Bg.surfaceRaised)
        )
        .overlay {
            Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
        .dsShadow(.raised)
    }

    // MARK: - Drop handling

    /// Validates and uploads each dropped image. Returns true to
    /// signal SwiftUI we accepted the drop (drives the green "+"
    /// indicator on the macOS drag cursor).
    private func handleDrop(providers: [NSItemProvider]) -> Bool {
        guard let noteId else { return false }
        var accepted = 0
        for provider in providers {
            let typeIdentifier: String
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                typeIdentifier = UTType.fileURL.identifier
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                typeIdentifier = UTType.image.identifier
            } else {
                continue
            }
            accepted += 1
            uploadingCount += 1
            provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
                let resolvedURL: URL? = {
                    if let url = item as? URL { return url }
                    if let data = item as? Data {
                        return URL(dataRepresentation: data, relativeTo: nil)
                    }
                    return nil
                }()
                Task { @MainActor in
                    defer { uploadingCount = max(0, uploadingCount - 1) }
                    guard let url = resolvedURL else {
                        showToast(message: "Couldn't read dropped file")
                        return
                    }
                    await uploadAttachment(noteId: noteId, fileURL: url)
                }
            }
        }
        return accepted > 0
    }

    private func uploadAttachment(noteId: String, fileURL: URL) async {
        guard let backend = viewModel.backendClient else { return }
        do {
            let attachment = try await backend.uploadNoteAttachment(
                mediaId: noteId,
                fileURL: fileURL
            )
            attachments.append(attachment)
            showToast(message: "File attached to note")
        } catch {
            showToast(message: "Couldn't attach \(fileURL.lastPathComponent)")
        }
    }

    private func showToast(message: String) {
        toastMessage = message
        let token = message
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            // Only clear if no newer toast replaced it.
            if toastMessage == token {
                toastMessage = nil
            }
        }
    }

    private func handleAppear() {
        // Auto-focus the body editor so the user can start typing
        // immediately — Granola does this. Slight delay so the
        // SwiftUI focus system has time to wire up after appear.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            bodyFocused = true
        }
        // Fetch attachments for whichever note is loaded. For
        // recording mode the active recording's id; for reviewing
        // the clicked recording's id. Both populate the bottom
        // attachments strip on first paint.
        if let noteId {
            Task {
                if let backend = viewModel.backendClient {
                    if let list = try? await backend.listNoteAttachments(mediaId: noteId) {
                        await MainActor.run { attachments = list }
                    }
                }
            }
        }
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

// MARK: - Title-bar buttons

/// Granola-shape home/back button — bordered pill housing a
/// chevron-left + house icon. Subtle bg fill on hover.
private struct HomeBackButton: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "chevron.left")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DSColor.Text.secondary)
            Image(systemName: "house")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DSColor.Text.secondary)
        }
        .padding(.horizontal, DSSpacing.sm)
        .padding(.vertical, 4)
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

/// Granola-shape ⋯ — bare three dots that gain a circle bg on
/// hover. Not a "button" until you hover it.
private struct GhostEllipsisButton: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Image(systemName: "ellipsis")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(hovering ? DSColor.Text.secondary : DSColor.Text.tertiary)
            .frame(width: 24, height: 24)
            .background(
                Circle()
                    .fill(hovering ? DSColor.Bg.subtle : Color.clear)
            )
            .contentShape(Circle())
            .overlay { ActionHitArea(action: action) }
            .onHover { hovering = $0 }
            .animation(LoomolaMotion.quick, value: hovering)
    }
}

// MARK: - Recording controls

/// Granola-shape Stop — small filled red square inside an outlined
/// pill. No "Stop" text; the icon + recording context conveys it.
private struct StopRecordingButton: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(DSColor.State.recording)
                .frame(width: 10, height: 10)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill(hovering ? DSColor.Bg.subtle : Color.clear)
        )
        .overlay {
            Capsule()
                .strokeBorder(DSColor.Border.strong, lineWidth: 1)
        }
        .contentShape(Capsule())
        .overlay { ActionHitArea(action: action) }
        .onHover { hovering = $0 }
        .help("Stop & upload")
        .animation(LoomolaMotion.quick, value: hovering)
    }
}

/// Five-bar live audio meter that scales heights smoothly with
/// `level` and uses a perceived-loudness curve (sqrt) so quiet
/// speech is still visible. Granola-style "subtle waveform"
/// approximation.
private struct AudioLevelMeter: View {
    let level: Double

    /// Per-bar shape multiplier so the meter has a visual peak in
    /// the middle (like an actual waveform), not flat across.
    private let multipliers: [Double] = [0.55, 0.85, 1.0, 0.85, 0.6]

    /// Linear input gets sqrt'd (perceived-loudness curve) and
    /// modestly amplified. Speech peak ~0.2-0.4 → effective 0.55-
    /// 0.78 → comfortably visible bars instead of nearly-static.
    private var amplified: Double {
        let l = max(0, min(1, level))
        return min(1.0, sqrt(l * 1.6))
    }

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(0..<5, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1)
                    .fill(DSColor.Accent.primary.opacity(0.85))
                    .frame(width: 2, height: barHeight(at: i))
            }
        }
        .frame(width: 22, height: 18, alignment: .center)
        .animation(.interpolatingSpring(stiffness: 180, damping: 15), value: amplified)
    }

    private func barHeight(at index: Int) -> CGFloat {
        let minH = 3.0
        let maxH = 18.0
        let scaled = amplified * multipliers[index]
        return CGFloat(minH + (maxH - minH) * scaled)
    }
}

// MARK: - Attachment thumbnails

private struct AttachmentThumbnail: View {
    let attachment: NoteAttachmentDTO
    @State private var hovering = false

    var body: some View {
        ZStack {
            if let url = URL(string: attachment.url) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: 72, height: 54)
        .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
        .scaleEffect(hovering ? 1.04 : 1.0)
        .onHover { hovering = $0 }
        .animation(LoomolaMotion.quick, value: hovering)
        .help(attachment.filename)
    }

    private var placeholder: some View {
        ZStack {
            Rectangle().fill(DSColor.Bg.subtle)
            Image(systemName: "photo")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
        }
    }
}

/// Granola-shape "still uploading" placeholder. Shown next to the
/// successfully-uploaded thumbnails while one or more uploads are
/// still in flight; replaced by the real thumbnail when the POST
/// returns. Mirrors the loading-circle spinner pattern Granola uses.
private struct UploadingThumbnailPlaceholder: View {
    var body: some View {
        ZStack {
            Rectangle().fill(DSColor.Bg.subtle)
            ProgressView()
                .controlSize(.small)
                .tint(DSColor.Text.secondary)
        }
        .frame(width: 72, height: 54)
        .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
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
