import AppKit
import SwiftUI
import UniformTypeIdentifiers

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

/// Granola-shape note workspace, embedded directly in the main
/// window when `MainRecorderView.noteTarget != nil`.
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
    @State private var recordingFolderId: String? = nil
    @State private var recordingFolderName: String? = nil
    @State private var noteTemplates: [NoteTemplateDTO] = []
    @State private var selectedTemplateId: String = "general-meeting"
    @State private var showTemplatePicker = false
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

    /// True while the cursor is anywhere over the workspace body
    /// — drives the appearance of the top-right `⋯` menu button.
    /// Granola pattern: keep the chrome out of the way until the
    /// user moves the mouse to do something.
    @State private var workspaceHovering = false

    /// When non-nil, shows a fullscreen preview overlay for the
    /// supplied attachment. Click outside / Escape dismisses.
    @State private var previewedAttachment: NoteAttachmentDTO? = nil

    /// AI-enhance state: idle | running | complete | failed.
    /// Drives the Generate-notes pill in review mode.
    @State private var enhanceStatus: EnhanceStatus = .idle
    @State private var pollEnhanceTask: Task<Void, Never>? = nil

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

    /// Folder fields are kept local so the pill updates immediately,
    /// then the selection is persisted to the backend.
    private var folderId: String? {
        switch target {
        case .recording: return recordingFolderId
        case .reviewing: return reviewFolderId
        }
    }

    private var folderName: String? {
        switch target {
        case .recording: return recordingFolderName
        case .reviewing: return reviewFolderName
        }
    }

    private var selectedTemplate: NoteTemplateDTO? {
        noteTemplates.first(where: { $0.id == selectedTemplateId }) ?? noteTemplates.first
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
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.xl) {
                    titleEditor
                    pillRow
                    bodyEditor
                }
                // Cap the readable column at ~640pt and center
                // horizontally so the editor doesn't sprawl across
                // a 1080+pt wide main window. Granola pattern —
                // narrow windows still fill, wide windows give a
                // comfortable reading width with margin.
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, DSSpacing.xl)
                .padding(.top, DSSpacing.lg)
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
                    .frame(maxWidth: 640, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, DSSpacing.xl)
                    .padding(.top, DSSpacing.sm)
                    .padding(.bottom, isRecording ? DSSpacing.sm : DSSpacing.lg)
            }

            if isRecording {
                // No divider — Granola's restraint pattern.
                recordingControlBar
                    .frame(maxWidth: 480)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, DSSpacing.lg)
                    .padding(.bottom, DSSpacing.lg)
            } else {
                // Reviewing mode: green ✦ Generate-notes pill anchored
                // bottom-center. POSTs /api/notes/<id>/enhance and
                // polls until status flips to complete.
                generateNotesBar
                    .padding(.horizontal, DSSpacing.lg)
                    .padding(.bottom, DSSpacing.lg)
            }
        }
        .background(DSColor.Bg.canvas)
        .overlay {
            if let preview = previewedAttachment {
                attachmentPreviewOverlay(preview)
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) {
            if let toastMessage {
                attachmentToast(message: toastMessage)
                    .padding(.bottom, isRecording ? 80 : DSSpacing.xl)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .toolbar {
            // Home button lives in the unified system NSToolbar
            // (inline with the macOS traffic lights). The ⋯ menu
            // does NOT — placing it as a `.primaryAction` toolbar
            // item visually grouped it with the home button (both
            // ended up on the left of the toolbar). The ⋯ now
            // renders as a hover-revealed overlay at the top-right
            // of the workspace body (see `workspaceHovering` /
            // `.overlay(alignment: .topTrailing)` below) — Granola
            // pattern, matches what was there before the toolbar
            // refactor.
            ToolbarItem(placement: .navigation) {
                HomeBackButton(action: onClose)
                    .help(isRecording ? "Hide" : "Close")
            }
        }
        .onContinuousHover { phase in
            switch phase {
            case .active:
                workspaceHovering = true
            case .ended:
                workspaceHovering = false
            }
        }
        .overlay(alignment: .topTrailing) {
            // Hover-only ellipsis. Sits in the top-right corner of
            // the workspace body, ~12pt from each edge — same
            // position the workspace's internal title-bar HStack
            // had before the Stage-8 toolbar-items refactor.
            if workspaceHovering || showRowMenu {
                GhostEllipsisButton {
                    showRowMenu.toggle()
                }
                .popover(isPresented: $showRowMenu, arrowEdge: .top) {
                    rowMenu
                }
                .padding(.top, DSSpacing.md)
                .padding(.trailing, DSSpacing.lg)
                .transition(.opacity)
            }
        }
        .animation(LoomolaMotion.quick, value: isDropTargeted)
        .animation(LoomolaMotion.medium, value: toastMessage)
        .animation(LoomolaMotion.quick, value: previewedAttachment)
        .animation(LoomolaMotion.quick, value: workspaceHovering)
        .onAppear { handleAppear() }
        .onDisappear {
            reviewAutosaveTask?.cancel()
            pollEnhanceTask?.cancel()
        }
        .onChange(of: reviewBody) { _, newValue in
            scheduleReviewAutosave(newValue)
        }
    }

    // MARK: - ⋯ menu content

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
        HStack(spacing: DSSpacing.md) {
            todayPill
            mePill
            folderPill
            templatePill
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
            let previousFolderId = recordingFolderId
            let previousFolderName = recordingFolderName
            let selectedFolderName = newFolderId.flatMap { id in
                viewModel.recentRecordings.folders.first(where: { $0.id == id })?.name
            }
            recordingFolderId = newFolderId
            recordingFolderName = selectedFolderName

            guard let recordingId = viewModel.activeAudioRecordingId,
                  let backend = viewModel.backendClient
            else {
                recordingFolderId = previousFolderId
                recordingFolderName = previousFolderName
                showToast(message: "Folder will be available after recording starts")
                return
            }

            Task {
                do {
                    try await backend.assignRecordingToFolder(
                        recordingId: recordingId,
                        folderId: newFolderId
                    )
                    showToast(message: selectedFolderName.map { "Added to \($0)" } ?? "Removed from folder")
                } catch {
                    recordingFolderId = previousFolderId
                    recordingFolderName = previousFolderName
                    showToast(message: "Couldn't save folder")
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

    @ViewBuilder
    private var templatePill: some View {
        WorkspacePill(
            icon: "book.closed",
            label: selectedTemplate?.name ?? "Template",
            isActive: true,
            action: { showTemplatePicker.toggle() }
        )
        .popover(isPresented: $showTemplatePicker, arrowEdge: .top) {
            NoteTemplatePickerPopover(
                templates: noteTemplates,
                selectedTemplateId: selectedTemplateId,
                onSelect: { template in
                    showTemplatePicker = false
                    handleTemplateSelect(template)
                }
            )
        }
    }

    private func handleTemplateSelect(_ template: NoteTemplateDTO) {
        guard selectedTemplateId != template.id else { return }
        guard let backend = viewModel.backendClient, let noteId else {
            selectedTemplateId = template.id
            return
        }
        let previous = selectedTemplateId
        selectedTemplateId = template.id
        Task {
            do {
                try await backend.setNoteTemplate(mediaId: noteId, templateId: template.id)
                showToast(message: "Template set to \(template.name)")
            } catch {
                selectedTemplateId = previous
                showToast(message: "Couldn't save template")
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

    /// THE canonical audio-recording control surface. Routed by
    /// MainRecorderView whenever an audio note is active — this is the
    /// pill the user actually clicks. RecordingHomeView is video-only;
    /// any audio-recording UI change MUST land here, not there.
    ///
    /// Single grouped pill. While recording: [meter] [v] | [timer] | [Pause].
    /// While paused: [meter dim] [v] | [timer frozen] | [Resume] |
    /// [End & upload]. Granola-style pause-by-default —
    /// the prominent button never finalizes the upload. End requires a
    /// pause first.
    private var recordingControlBar: some View {
        HStack(spacing: 0) {
            // Meter + chevron (transcription drawer placeholder).
            // Meter shows 0 while paused (engines run but buffers are
            // dropped, so meter readings would be misleading).
            HStack(spacing: 8) {
                AudioLevelMeter(
                    level: viewModel.isAudioNotePaused ? 0 : viewModel.audioLevel
                )
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            .padding(.leading, 14)
            .padding(.trailing, 12)

            pillSeparator

            // Timer. While paused, freeze at the elapsed-at-pause value
            // so the user sees a stable number and gets visual feedback
            // that the recording isn't accumulating dead air.
            if let startedAt = viewModel.activeAudioRecordingStartedAt {
                Group {
                    if viewModel.isAudioNotePaused, let pausedAt = viewModel.audioNotePausedAt {
                        let frozen = pausedAt.timeIntervalSince(startedAt)
                            - viewModel.audioNotePausedAccumulatedSeconds
                        Text(elapsedString(seconds: max(0, frozen)))
                            .font(DSFont.Mono.body())
                            .foregroundStyle(DSColor.Text.tertiary)
                            .monospacedDigit()
                    } else {
                        TimelineView(.periodic(from: startedAt, by: 1)) { ctx in
                            let elapsed = ctx.date.timeIntervalSince(startedAt)
                                - viewModel.audioNotePausedAccumulatedSeconds
                            Text(elapsedString(seconds: max(0, elapsed)))
                                .font(DSFont.Mono.body())
                                .foregroundStyle(DSColor.Text.secondary)
                                .monospacedDigit()
                        }
                    }
                }
                .padding(.horizontal, 14)
            }

            pillSeparator

            if viewModel.isAudioNotePaused {
                // ▶ Resume — primary action when paused.
                Image(systemName: "play.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DSColor.Accent.primary)
                    .frame(width: 12, height: 12)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                    .overlay {
                        ActionHitArea {
                            viewModel.resumeAudioNoteRecording()
                        }
                    }
                    .help("Resume recording")

                pillSeparator

                // ✓ End & upload — explicit second click to finalize.
                // Subtler than Resume so the user has to deliberately
                // pick "I'm done" rather than misclick out of a pause.
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DSColor.Text.tertiary)
                    .frame(width: 12, height: 12)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                    .overlay {
                        ActionHitArea {
                            viewModel.stopAudioNoteRecordingAndUpload()
                        }
                    }
                    .help("End & upload")
            } else {
                // Pause — keeps the prominent live action recoverable.
                // Granola pattern: the
                // most prominent button on a live recording is always
                // the recoverable action, never the upload trigger.
                Image(systemName: "pause.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DSColor.State.recording)
                    .frame(width: 12, height: 12)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                    .overlay {
                        ActionHitArea {
                            viewModel.pauseAudioNoteRecording()
                        }
                    }
                    .help("Pause (click again to resume; End & upload appears once paused)")
            }
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

    // MARK: - Generate-notes bar (reviewing mode only)

    /// Bottom-anchored AI-enhance pill. ✦ Generate notes (idle) →
    /// "Generating…" with spinner (running) → "Notes updated" check
    /// (complete, ~2.5s) → back to idle. Reads + writes title and
    /// body via the same bindings as the editors so updates reflect
    /// immediately without re-fetching from the server.
    private var generateNotesBar: some View {
        HStack {
            Spacer()
            Group {
                switch enhanceStatus {
                case .idle:
                    Button(action: startEnhance) {
                        HStack(spacing: 8) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Generate notes")
                                .font(DSFont.Body.md())
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(DSColor.State.success))
                    }
                    .buttonStyle(.plain)
                    .help("Re-run AI to refine title + summary from transcript and your notes")
                case .running:
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                            .tint(DSColor.Text.secondary)
                        Text("Generating notes…")
                            .font(DSFont.Body.md())
                            .foregroundStyle(DSColor.Text.secondary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(DSColor.Bg.surface))
                    .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
                case .complete:
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DSColor.State.success)
                        Text("Notes updated")
                            .font(DSFont.Body.md())
                            .foregroundStyle(DSColor.Text.primary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(DSColor.Bg.surface))
                    .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
                case .failed:
                    Button(action: startEnhance) {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(DSColor.State.danger)
                            Text("Try again")
                                .font(DSFont.Body.md())
                                .foregroundStyle(DSColor.Text.primary)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(DSColor.Bg.surface))
                        .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
                    }
                    .buttonStyle(.plain)
                }
            }
            .animation(LoomolaMotion.quick, value: enhanceStatus)
            Spacer()
        }
    }

    // MARK: - Attachment preview overlay

    /// Quick-Look-style fullscreen overlay anchored to the workspace
    /// panel. Click outside the image (or the close button) dismisses.
    private func attachmentPreviewOverlay(_ attachment: NoteAttachmentDTO) -> some View {
        ZStack {
            Color.black.opacity(0.78)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { previewedAttachment = nil }

            if let url = URL(string: attachment.url) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .padding(DSSpacing.xl)
                    case .failure:
                        Text("Couldn't load image")
                            .foregroundStyle(.white)
                    default:
                        ProgressView().tint(.white)
                    }
                }
            }

            // Top-right close button. White-on-translucent so it's
            // visible against any image.
            VStack {
                HStack {
                    Spacer()
                    Button(action: { previewedAttachment = nil }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(.black.opacity(0.5)))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, DSSpacing.md)
                    .padding(.trailing, DSSpacing.md)
                }
                Spacer()
            }
        }
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
                    AttachmentThumbnail(
                        attachment: attachment,
                        onOpen: { previewedAttachment = attachment },
                        onRemove: {
                            Task { await removeAttachment(attachment) }
                        }
                    )
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

    /// Optimistic remove: drops from local list immediately so the
    /// thumbnail disappears, then DELETEs server-side. On failure,
    /// restores from snapshot and surfaces a toast.
    private func removeAttachment(_ attachment: NoteAttachmentDTO) async {
        guard let backend = viewModel.backendClient, let noteId else { return }
        let snapshot = attachments
        attachments.removeAll(where: { $0.id == attachment.id })
        if previewedAttachment?.id == attachment.id { previewedAttachment = nil }
        do {
            try await backend.deleteNoteAttachment(
                mediaId: noteId,
                attachmentId: attachment.id
            )
            showToast(message: "Attachment removed")
        } catch {
            attachments = snapshot
            showToast(message: "Couldn't remove attachment")
        }
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
                    if let response = try? await backend.listNoteTemplates() {
                        await MainActor.run { noteTemplates = response.templates }
                    }
                    if case .recording = target,
                       let note = try? await backend.getNote(mediaId: noteId),
                       let templateId = note.templateId {
                        await MainActor.run { selectedTemplateId = templateId }
                    }
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
                        let note = try await backend.getNote(mediaId: recording.id)
                        await MainActor.run {
                            reviewBody = note.body ?? ""
                            reviewLastSaved = note.body ?? ""
                            if let templateId = note.templateId {
                                selectedTemplateId = templateId
                            }
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

    // MARK: - AI enhance

    /// Kicks off a re-run of the AI title + summary pipeline against
    /// the latest transcript + the user's typed notes. Polls every 3s
    /// until the server reports `complete` (or `failed`). On
    /// completion the title and body bindings update in-place so the
    /// editor reflects the new copy without a re-fetch.
    private func startEnhance() {
        guard case .reviewing(let recording) = target else { return }
        guard let backend = viewModel.backendClient else { return }
        guard enhanceStatus != .running else { return }

        // Flush any pending autosave so the AI run sees the user's
        // latest typed notes (it reads `notes.body` server-side).
        reviewAutosaveTask?.cancel()
        let bodyToFlush = reviewBody

        pollEnhanceTask?.cancel()
        enhanceStatus = .running

        pollEnhanceTask = Task { @MainActor in
            do {
                if bodyToFlush != reviewLastSaved {
                    try? await backend.putNoteBody(mediaId: recording.id, body: bodyToFlush)
                    reviewLastSaved = bodyToFlush
                }
                try await backend.enhanceNote(
                    mediaId: recording.id,
                    templateId: selectedTemplateId
                )
            } catch {
                enhanceStatus = .failed
                showToast(message: "Couldn't start AI run")
                return
            }

            // Poll up to 60s @ 3s intervals.
            let deadline = Date().addingTimeInterval(60)
            while Date() < deadline {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled { return }
                guard let status = try? await backend.getEnhancementStatus(mediaId: recording.id) else {
                    continue
                }
                switch status.generationStatus {
                case "complete":
                    if let suggested = status.titleSuggested, !suggested.isEmpty {
                        reviewTitle = suggested
                    }
                    if let summary = status.summary, !summary.isEmpty {
                        reviewBody = summary
                        reviewLastSaved = summary
                    }
                    if let templateId = status.templateId {
                        selectedTemplateId = templateId
                    }
                    enhanceStatus = .complete
                    showToast(message: "Notes updated")
                    // Auto-revert pill after a beat so it's
                    // re-runnable.
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                    if !Task.isCancelled { enhanceStatus = .idle }
                    return
                case "failed":
                    enhanceStatus = .failed
                    showToast(message: "AI run failed")
                    return
                default:
                    continue
                }
            }
            // Timeout — tell user to refresh later.
            enhanceStatus = .idle
            showToast(message: "Still running — check back shortly")
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
        elapsedString(seconds: max(0, now.timeIntervalSince(startedAt)))
    }

    private func elapsedString(seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
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

private struct NoteTemplatePickerPopover: View {
    let templates: [NoteTemplateDTO]
    let selectedTemplateId: String
    let onSelect: (NoteTemplateDTO) -> Void

    @State private var previewId: String?

    private var categories: [String] {
        var result: [String] = []
        for template in templates where !result.contains(template.category) {
            result.append(template.category)
        }
        return result
    }

    private var preview: NoteTemplateDTO? {
        let id = previewId ?? selectedTemplateId
        return templates.first(where: { $0.id == id }) ?? templates.first
    }

    var body: some View {
        HStack(spacing: 0) {
            templateList
                .frame(width: 220)
                .background(DSColor.Bg.surface)

            Divider().overlay(DSColor.Border.subtle)

            if let preview {
                templateDetail(preview)
                    .frame(width: 340)
            } else {
                Text("No templates")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .frame(width: 340, height: 260)
            }
        }
        .frame(height: 420)
        .background(DSColor.Bg.surfaceRaised)
        .onAppear {
            previewId = selectedTemplateId
        }
    }

    private var templateList: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Note templates")
                .font(DSFont.Body.lg())
                .foregroundStyle(DSColor.Text.primary)
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, DSSpacing.sm)

            Divider().overlay(DSColor.Border.subtle)

            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    ForEach(categories, id: \.self) { category in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(category)
                                .font(DSFont.Body.sm())
                                .foregroundStyle(DSColor.Text.tertiary)
                                .padding(.horizontal, DSSpacing.md)
                            ForEach(templates.filter { $0.category == category }) { template in
                                templateRow(template)
                            }
                        }
                    }
                }
                .padding(.vertical, DSSpacing.sm)
            }
        }
    }

    private func templateRow(_ template: NoteTemplateDTO) -> some View {
        let isPreview = (previewId ?? selectedTemplateId) == template.id
        let isSelected = selectedTemplateId == template.id
        return HStack(spacing: DSSpacing.sm) {
            Image(systemName: "book.closed")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DSColor.Accent.primary)
                .frame(width: 16)
            Text(template.name)
                .font(DSFont.Body.md())
                .foregroundStyle(isPreview ? DSColor.Text.primary : DSColor.Text.secondary)
                .lineLimit(1)
            Spacer(minLength: 0)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DSColor.Accent.primary)
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 7)
        .background(isPreview ? DSColor.Bg.subtle : Color.clear)
        .contentShape(Rectangle())
        .overlay {
            ActionHitArea {
                previewId = template.id
            }
        }
    }

    private func templateDetail(_ template: NoteTemplateDTO) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text(template.category)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Accent.primary)
                Text(template.name)
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text(template.description)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.sm) {
                    detailBlock(title: "Meeting context", body: template.meetingContext)
                    ForEach(template.sections, id: \.title) { section in
                        detailBlock(title: section.title, body: section.prompt)
                    }
                }
            }

            Button {
                onSelect(template)
            } label: {
                Text(selectedTemplateId == template.id ? "Selected" : "Use template")
                    .font(DSFont.Body.md())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 9)
                    .background(Capsule().fill(DSColor.State.success))
            }
            .buttonStyle(.plain)
            .disabled(selectedTemplateId == template.id)
            .opacity(selectedTemplateId == template.id ? 0.65 : 1)
        }
        .padding(DSSpacing.lg)
    }

    private func detailBlock(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
            Text(body)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DSColor.Bg.subtle, in: RoundedRectangle(cornerRadius: DSRadius.md))
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
    let onOpen: () -> Void
    let onRemove: () -> Void
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
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .contextMenu {
            Button("Open preview") { onOpen() }
            Divider()
            Button(role: .destructive) {
                onRemove()
            } label: {
                Label("Remove", systemImage: "trash")
            }
        }
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
