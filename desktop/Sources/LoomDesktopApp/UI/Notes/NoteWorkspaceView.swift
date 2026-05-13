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

private enum WorkspaceToastTone {
    case success
    case warning
    case error

    var icon: String {
        switch self {
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "exclamationmark.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .success: return DSColor.State.success
        case .warning: return DSColor.State.warning
        case .error: return DSColor.State.danger
        }
    }
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

private struct TranscriptDisplayBubble: Identifiable, Equatable {
    let id: String
    let source: LiveTranscriptAudioSource?
    let speaker: String?
    let text: String
    let isInterim: Bool
    let startSec: Double
    let endSec: Double
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
/// Review mode includes a saved-transcript drawer. Recording mode
/// uses Deepgram's live stream so the user can visually verify words
/// during the call and press Generate notes only when ready.
struct NoteWorkspaceView: View {
    @ObservedObject var viewModel: RecorderViewModel
    let target: NoteWorkspaceTarget
    let chromeYOffset: CGFloat
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
    @State private var bodyEditorMeasuredHeight: CGFloat = 320
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
    /// Bottom-anchored toast that fades in/out after transient
    /// workspace feedback.
    @State private var toastMessage: String? = nil
    @State private var toastTone: WorkspaceToastTone = .success

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
    @State private var enhanceFailureMessage: String? = nil
    @State private var enhanceFailureIsRetryable = true
    @State private var transcriptRetryAvailable = false
    @State private var transcriptRetrying = false
    @State private var pollEnhanceTask: Task<Void, Never>? = nil

    /// Persisted transcript from the server. v1 small win: this is
    /// post-upload/batch transcript, not live streaming yet.
    @State private var transcript: NoteTranscriptResponse? = nil
    @State private var transcriptDrawerOpen = false
    @State private var loadingTranscript = false
    @State private var transcriptError: String? = nil
    @State private var notesGeneratedForCurrentTranscript = false
    @State private var transcriptUpdatedAfterGeneration = false
    @State private var lastGeneratedTranscriptFingerprint: String? = nil
    @State private var transcriptSearchVisible = false
    @State private var transcriptSearchQuery = ""
    @FocusState private var transcriptSearchFocused: Bool

    private var isRecording: Bool {
        if case .recording = target { return true }
        return false
    }

    private var transcriptDrawerMaxWidth: CGFloat { 720 }

    private var shouldShowGenerateNotesBar: Bool {
        !isRecording || shouldShowGenerateNotesPill
    }

    private var shouldShowGenerateNotesPill: Bool {
        switch enhanceStatus {
        case .idle:
            return transcriptUpdatedAfterGeneration || !notesGeneratedForCurrentTranscript
        case .running, .complete, .failed:
            return true
        }
    }

    private var noteChromeLeadingPadding: CGFloat { 112 }
    /// Shared titlebar grid for every note-workspace chrome icon.
    /// Keep left/right actions on this same top padding so their
    /// visual centers bisect the macOS traffic-light centers.
    private var noteChromeTopPadding: CGFloat { DSSpacing.md }

    /// Title bound to the right state container depending on mode.
    private var titleBinding: Binding<String> {
        switch target {
        case .recording:
            return Binding(
                get: { viewModel.audioTitle },
                set: { viewModel.setAudioTitle($0) }
            )
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
                if transcriptDrawerOpen {
                    transcriptDrawer
                        .frame(maxWidth: transcriptDrawerMaxWidth)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.horizontal, DSSpacing.xl)
                        .padding(.bottom, DSSpacing.sm)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                if viewModel.isAudioNotePaused && shouldShowGenerateNotesBar {
                    generateNotesBar
                        .padding(.horizontal, DSSpacing.lg)
                        .padding(.bottom, DSSpacing.sm)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                // No divider — Granola's restraint pattern.
                recordingControlBar
                    .frame(maxWidth: viewModel.isAudioNotePaused ? 520 : 480)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, DSSpacing.lg)
                    .padding(.bottom, DSSpacing.lg)
            } else {
                if transcriptDrawerOpen {
                    transcriptDrawer
                        .frame(maxWidth: transcriptDrawerMaxWidth)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.horizontal, DSSpacing.xl)
                        .padding(.bottom, DSSpacing.sm)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
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
                attachmentToast(message: toastMessage, tone: toastTone)
                    .padding(.bottom, isRecording ? 80 : DSSpacing.xl)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .overlay(alignment: .topLeading) {
            HomeBackButton(action: onClose)
                .help(isRecording ? "Hide" : "Close")
                .padding(.leading, noteChromeLeadingPadding)
                .padding(.top, noteChromeTopPadding)
                .offset(y: chromeYOffset)
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
            // Keep the hit target mounted even when the dots are
            // visually quiet. The lifted titlebar area is outside
            // parts of the workspace hover region, so conditionally
            // removing this view makes the dots vanish under the
            // cursor before SwiftUI can enter the button hover state.
            GhostEllipsisButton(isVisible: workspaceHovering || showRowMenu) {
                showRowMenu.toggle()
            }
            .popover(isPresented: $showRowMenu, arrowEdge: .top) {
                rowMenu
            }
            .padding(.top, noteChromeTopPadding)
            .padding(.trailing, DSSpacing.lg)
            .offset(y: chromeYOffset)
        }
        .animation(LoomolaMotion.quick, value: isDropTargeted)
        .animation(LoomolaMotion.medium, value: toastMessage)
        .animation(LoomolaMotion.quick, value: previewedAttachment)
        .animation(LoomolaMotion.quick, value: workspaceHovering)
        .animation(LoomolaMotion.medium, value: transcriptDrawerOpen)
        .background(
            Button("") {
                openTranscriptSearch()
            }
            .keyboardShortcut("f", modifiers: .command)
            .opacity(0)
        )
        .onAppear { handleAppear() }
        .onDisappear {
            reviewAutosaveTask?.cancel()
            pollEnhanceTask?.cancel()
        }
        .onChange(of: reviewBody) { _, newValue in
            scheduleReviewAutosave(newValue)
        }
        .onChange(of: viewModel.liveTranscription.segments) { _, _ in
            markTranscriptUpdatedAfterGenerationIfNeeded()
        }
        .onChange(of: viewModel.liveTranscription.interimBySource) { _, _ in
            markTranscriptUpdatedAfterGenerationIfNeeded()
        }
        .onChange(of: transcript?.fullText ?? "") { _, _ in
            markTranscriptUpdatedAfterGenerationIfNeeded()
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
            .allowsHitTesting(isTitleEditable)
            .focusable(isTitleEditable)
    }

    private var titlePlaceholder: String {
        switch target {
        case .recording: return "New note"
        case .reviewing: return reviewTitle.isEmpty ? "Untitled" : ""
        }
    }

    private var isTitleEditable: Bool {
        // Title edits during recording are debounced to the backend.
        // Review-mode renaming is a separate polish pass.
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
                showToast(message: "Folder will be available after recording starts", tone: .warning)
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
                    showToast(message: "Couldn't save folder", tone: .error)
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
            isActive: false,
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
                showToast(message: "Couldn't save template", tone: .error)
            }
        }
    }

    // MARK: - Body

    private var bodyEditor: some View {
        ZStack(alignment: .topLeading) {
            MarkdownTextEditor(
                text: bodyBinding,
                measuredHeight: $bodyEditorMeasuredHeight,
                placeholder: loadingBody ? "Loading…" : "Write notes",
                isFocused: $bodyFocused
            )
            .frame(height: max(320, bodyEditorMeasuredHeight))
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
                Image(systemName: transcriptDrawerOpen ? "chevron.down" : "chevron.up")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            .padding(.leading, 14)
            .padding(.trailing, 12)
            .contentShape(Rectangle())
            .overlay {
                ActionHitArea {
                    transcriptDrawerOpen.toggle()
                    if transcriptDrawerOpen, !isRecording, transcript == nil, !loadingTranscript {
                        loadTranscript()
                    }
                }
            }
            .help(isRecording ? "Show live transcript" : "Show transcript")

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
                HStack(spacing: 7) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 10, weight: .semibold))
                    Text("Resume")
                        .font(DSFont.Body.md().weight(.medium))
                }
                    .foregroundStyle(DSColor.State.success)
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

    // MARK: - Generate-notes bar

    /// Bottom-anchored AI-enhance pill. ✦ Generate notes (idle) →
    /// "Generating…" with spinner (running) → "Notes updated" check
    /// (complete, ~2.5s) → back to idle. Reads + writes title and
    /// body via the same bindings as the editors so updates reflect
    /// immediately without re-fetching from the server.
    private var generateNotesBar: some View {
        HStack {
            Spacer()
            HStack(spacing: DSSpacing.sm) {
                transcriptTogglePill
                generateNotesPill
            }
            Spacer()
        }
    }

    @ViewBuilder
    private var generateNotesPill: some View {
        switch enhanceStatus {
        case .idle:
            if transcriptUpdatedAfterGeneration {
                transcriptUpdatedPill
            } else if !notesGeneratedForCurrentTranscript {
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
                .help("Generate title + summary from transcript and your notes")
            }
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
            if transcriptRetryAvailable {
                Button(action: retryTranscript) {
                    failedGenerateNotesPill
                }
                .buttonStyle(.plain)
                .disabled(transcriptRetrying)
            } else if enhanceFailureIsRetryable {
                Button(action: startEnhance) {
                    failedGenerateNotesPill
                }
                .buttonStyle(.plain)
            } else {
                failedGenerateNotesPill
            }
        }
    }

    private var transcriptUpdatedPill: some View {
        HStack(spacing: DSSpacing.sm) {
            HStack(spacing: 7) {
                Circle()
                    .fill(DSColor.Accent.primary)
                    .frame(width: 5, height: 5)
                Text("Transcript updated")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
            }
            Button(action: startEnhance) {
                Text("Regenerate notes")
                    .font(DSFont.Body.md().weight(.medium))
                    .foregroundStyle(DSColor.Text.primary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(
                        RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                            .fill(DSColor.Bg.subtle)
                    )
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.Bg.surfaceRaised)
        )
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
        .help("Transcript changed since the last AI note generation")
    }

    private var transcriptTogglePill: some View {
        Button {
            transcriptDrawerOpen.toggle()
            if transcriptDrawerOpen, !isRecording, transcript == nil, !loadingTranscript {
                loadTranscript()
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "text.bubble")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(transcriptDrawerOpen ? DSColor.Accent.primary : DSColor.Text.secondary)
                Text(isRecording ? "Live transcript" : "Transcript")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                Image(systemName: transcriptDrawerOpen ? "chevron.down" : "chevron.up")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Capsule().fill(DSColor.Bg.surface))
            .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .help(isRecording ? "Show live transcript" : "Show transcript")
    }

    private var failedGenerateNotesPill: some View {
        HStack(spacing: 8) {
            Image(systemName: transcriptRetryAvailable ? "arrow.clockwise" : (enhanceFailureIsRetryable ? "exclamationmark.triangle.fill" : "clock"))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle((enhanceFailureIsRetryable || transcriptRetryAvailable) ? DSColor.State.warning : DSColor.Text.secondary)
            Text(enhanceFailureMessage ?? "Try again")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Capsule().fill(DSColor.Bg.surface))
        .overlay { Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1) }
        .help(enhanceFailureMessage ?? "Try again")
    }

    private var transcriptDrawer: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: DSSpacing.sm) {
                TranscriptToolbarIconButton(
                    icon: "magnifyingglass",
                    help: "Find in transcript (⌘F)",
                    isActive: transcriptSearchVisible,
                    action: toggleTranscriptSearch
                )
                Image(systemName: "text.bubble")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DSColor.Text.secondary)
                Text(isRecording ? "Live transcript" : "Transcript")
                    .font(DSFont.Body.md().weight(.medium))
                    .foregroundStyle(DSColor.Text.primary)
                let wordCount = isRecording ? liveTranscriptWordCount : (transcript?.wordCount ?? 0)
                if wordCount > 0 {
                    Text("\(wordCount) words")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                }
                Spacer()
                Button {
                    copyTranscript()
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DSColor.Text.secondary)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .disabled(transcriptTextForCopy.isEmpty)
                .opacity(transcriptTextForCopy.isEmpty ? 0.45 : 1)
                .help("Copy transcript")
                Button {
                    transcriptDrawerOpen = false
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DSColor.Text.secondary)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .help("Hide transcript")
            }
            .padding(.horizontal, DSSpacing.lg)
            .padding(.top, DSSpacing.md)
            .padding(.bottom, DSSpacing.xs)

            if transcriptSearchVisible {
                transcriptSearchBar
                    .padding(.horizontal, DSSpacing.lg)
                    .padding(.bottom, DSSpacing.sm)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            ScrollView {
                Group {
                    if isRecording {
                        liveTranscriptContent
                    } else {
                        transcriptContent
                    }
                }
                .padding(.horizontal, DSSpacing.lg)
                .padding(.top, DSSpacing.sm)
                .padding(.bottom, DSSpacing.lg)
            }
            .frame(maxHeight: 300)
        }
        .background(RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous).fill(DSColor.Bg.surfaceRaised))
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
        .dsShadow(.raised)
        .animation(LoomolaMotion.quick, value: transcriptSearchVisible)
    }

    private var transcriptSearchBar: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
            TextField("Find in transcript", text: $transcriptSearchQuery)
                .textFieldStyle(.plain)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.primary)
                .focused($transcriptSearchFocused)
            if !normalizedTranscriptSearchQuery.isEmpty {
                Text("\(transcriptSearchMatchCount)")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                Button {
                    transcriptSearchQuery = ""
                    transcriptSearchFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(DSColor.Text.tertiary)
                }
                .buttonStyle(.plain)
                .help("Clear search")
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.Bg.subtle.opacity(0.72))
        )
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .strokeBorder(DSColor.Border.subtle.opacity(0.65), lineWidth: 1)
        }
    }

    @ViewBuilder
    private var transcriptContent: some View {
        if loadingTranscript {
            HStack(spacing: DSSpacing.sm) {
                ProgressView().controlSize(.small)
                Text("Loading transcript…")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else if let transcriptError {
            Text(transcriptError)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if let transcript, !transcript.paragraphs.isEmpty {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                ForEach(transcript.paragraphs) { paragraph in
                    let source = transcriptSource(forSpeaker: paragraph.speaker)
                    transcriptBubble(
                        TranscriptDisplayBubble(
                            id: paragraph.id,
                            source: source,
                            speaker: source?.displayName ?? paragraph.speaker,
                            text: paragraph.text,
                            isInterim: false,
                            startSec: paragraph.startSec,
                            endSec: paragraph.endSec
                        )
                    )
                }
            }
        } else if let transcript, !transcript.fullText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text(transcript.fullText)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if transcript != nil {
            Text("No speech was saved in this transcript. Use Retry transcript if the recording should contain speech.")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text("Transcript will appear here after Deepgram finishes processing.")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var liveTranscriptContent: some View {
        let segments = viewModel.liveTranscription.segments
        let hasInterim = viewModel.liveTranscription.interimBySource.values.contains {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        if !viewModel.liveTranscriptionEnabled {
            Text("Live transcription is off. Turn it on in Settings.")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if segments.isEmpty && !hasInterim {
            liveTranscriptEmptyState
        } else {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                ForEach(liveTranscriptBubbles) { bubble in
                    transcriptBubble(bubble)
                }
            }
        }
    }

    @ViewBuilder
    private var liveTranscriptEmptyState: some View {
        switch viewModel.liveTranscription.status {
        case .disabled:
            Text("Live transcription is off. Turn it on in Settings.")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .unavailable(let message):
            Text(message.isEmpty ? "Live transcription could not start. Batch transcript will still run after upload." : message)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .connecting:
            HStack(spacing: DSSpacing.sm) {
                ProgressView().controlSize(.small)
                Text("Connecting live transcript…")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .idle, .streaming:
            Text("Listening…")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var liveTranscriptBubbles: [TranscriptDisplayBubble] {
        var bubbles: [TranscriptDisplayBubble] = []
        for segment in viewModel.liveTranscription.segments {
            let text = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            if let last = bubbles.last,
               last.source == segment.source,
               !last.isInterim,
               segment.startSec - last.endSec < 2.5 {
                bubbles[bubbles.count - 1] = TranscriptDisplayBubble(
                    id: last.id,
                    source: last.source,
                    speaker: last.speaker,
                    text: [last.text, text].joined(separator: " "),
                    isInterim: false,
                    startSec: last.startSec,
                    endSec: segment.endSec
                )
            } else {
                bubbles.append(
                    TranscriptDisplayBubble(
                        id: segment.id.uuidString,
                        source: segment.source,
                        speaker: segment.source.displayName,
                        text: text,
                        isInterim: false,
                        startSec: segment.startSec,
                        endSec: segment.endSec
                    )
                )
            }
        }

        for source in LiveTranscriptAudioSource.allCases {
            if let interim = viewModel.liveTranscription.interimBySource[source],
               !interim.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                bubbles.append(
                    TranscriptDisplayBubble(
                        id: "interim-\(source.rawValue)",
                        source: source,
                        speaker: source.displayName,
                        text: interim.trimmingCharacters(in: .whitespacesAndNewlines),
                        isInterim: true,
                        startSec: bubbles.last?.endSec ?? 0,
                        endSec: bubbles.last?.endSec ?? 0
                    )
                )
            }
        }
        return bubbles
    }

    private func transcriptBubble(_ bubble: TranscriptDisplayBubble) -> some View {
        let isMine = bubble.source == .microphone
        let alignment: Alignment = isMine ? .trailing : .leading
        let horizontalAlignment: HorizontalAlignment = isMine ? .trailing : .leading
        let speaker = bubble.speaker?.trimmingCharacters(in: .whitespacesAndNewlines)
        let isSearchMatch = transcriptBubbleMatchesSearch(bubble)

        return HStack(alignment: .bottom, spacing: 0) {
            if isMine { Spacer(minLength: 54) }
            VStack(alignment: horizontalAlignment, spacing: 5) {
                if let speaker, !speaker.isEmpty {
                    Text(speaker)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary.opacity(0.9))
                        .padding(.horizontal, 4)
                }
                Text(bubble.text)
                    .font(.system(size: 13, weight: .regular))
                    .lineSpacing(2.5)
                    .foregroundStyle(bubble.isInterim ? DSColor.Text.secondary.opacity(0.85) : DSColor.Text.primary.opacity(0.82))
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .fill(transcriptBubbleFill(source: bubble.source, isInterim: bubble.isInterim))
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .strokeBorder(
                                isSearchMatch
                                    ? DSColor.Accent.primary.opacity(0.7)
                                    : transcriptBubbleStroke(source: bubble.source),
                                lineWidth: isSearchMatch ? 1.4 : 1
                            )
                            .opacity(isSearchMatch || bubble.source == .systemAudio ? 0.75 : 0)
                    }
            }
            .frame(maxWidth: 560, alignment: alignment)
            if !isMine { Spacer(minLength: 54) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func transcriptBubbleFill(source: LiveTranscriptAudioSource?, isInterim: Bool) -> Color {
        let fill: Color
        switch source {
        case .microphone:
            fill = DSColor.Bg.subtle.opacity(0.76)
        case .systemAudio:
            fill = DSColor.Bg.surface.opacity(0.82)
        case .none:
            fill = DSColor.Bg.subtle.opacity(0.74)
        }
        return isInterim ? fill.opacity(0.68) : fill
    }

    private func transcriptBubbleStroke(source: LiveTranscriptAudioSource?) -> Color {
        source == .systemAudio ? DSColor.Border.subtle : .clear
    }

    private var liveTranscriptWordCount: Int {
        viewModel.liveTranscription
            .snapshot(includeInterim: true)
            .fullText
            .split { $0.isWhitespace || $0.isNewline }
            .count
    }

    private var normalizedTranscriptSearchQuery: String {
        transcriptSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var transcriptSearchMatchCount: Int {
        let query = normalizedTranscriptSearchQuery
        guard !query.isEmpty else { return 0 }
        return transcriptSearchableTexts.reduce(0) { count, text in
            count + text.localizedCaseInsensitiveOccurrenceCount(of: query)
        }
    }

    private var transcriptSearchableTexts: [String] {
        if isRecording {
            return liveTranscriptBubbles.map(\.text)
        }
        if let transcript, !transcript.paragraphs.isEmpty {
            return transcript.paragraphs.map(\.text)
        }
        if let transcript {
            let text = transcript.fullText.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? [] : [text]
        }
        return []
    }

    private func transcriptBubbleMatchesSearch(_ bubble: TranscriptDisplayBubble) -> Bool {
        let query = normalizedTranscriptSearchQuery
        guard !query.isEmpty else { return false }
        return bubble.text.localizedCaseInsensitiveContains(query)
    }

    private func openTranscriptSearch() {
        if !transcriptDrawerOpen {
            transcriptDrawerOpen = true
            if !isRecording, transcript == nil, !loadingTranscript {
                loadTranscript()
            }
        }
        transcriptSearchVisible = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            transcriptSearchFocused = true
        }
    }

    private func toggleTranscriptSearch() {
        if transcriptSearchVisible {
            transcriptSearchVisible = false
            transcriptSearchQuery = ""
            transcriptSearchFocused = false
        } else {
            openTranscriptSearch()
        }
    }

    private func transcriptSource(forSpeaker speaker: String?) -> LiveTranscriptAudioSource? {
        guard transcript?.provider == "deepgram-live" else { return nil }
        switch speaker {
        case "Speaker 1": return .microphone
        case "Speaker 2": return .systemAudio
        default: return nil
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

    /// Bottom-anchored feedback pill. Auto-dismisses after ~2.5s.
    private func attachmentToast(message: String, tone: WorkspaceToastTone) -> some View {
        HStack(spacing: 8) {
            Image(systemName: tone.icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(tone.tint)
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
                        showToast(message: "Couldn't read dropped file", tone: .error)
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
            showToast(message: "Couldn't remove attachment", tone: .error)
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
            showToast(message: "Couldn't attach \(fileURL.lastPathComponent)", tone: .error)
        }
    }

    private func showToast(message: String, tone: WorkspaceToastTone = .success) {
        toastMessage = message
        toastTone = tone
        let token = message
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            // Only clear if no newer toast replaced it.
            if toastMessage == token {
                toastMessage = nil
            }
        }
    }

    private var transcriptTextForCopy: String {
        if isRecording {
            return viewModel.liveTranscription
                .snapshot(includeInterim: true)
                .fullText
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let transcript else { return "" }
        if !transcript.paragraphs.isEmpty {
            return transcript.paragraphs
                .map { paragraph in
                    let speakerPrefix = paragraph.speaker.map { "\($0): " } ?? ""
                    return "\(speakerPrefix)\(paragraph.text)"
                }
                .joined(separator: "\n\n")
        }
        return transcript.fullText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var currentTranscriptFingerprint: String {
        if isRecording {
            return viewModel.liveTranscription
                .snapshot(includeInterim: true)
                .fullText
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let transcript else { return "" }
        return transcriptFingerprint(from: transcript)
    }

    private func transcriptFingerprint(from response: NoteTranscriptResponse) -> String {
        let paragraphText = response.paragraphs
            .map { paragraph in
                [
                    paragraph.speaker ?? "",
                    String(format: "%.2f", paragraph.startSec),
                    paragraph.text.trimmingCharacters(in: .whitespacesAndNewlines),
                ].joined(separator: "|")
            }
            .joined(separator: "\n")
        let normalized = paragraphText.isEmpty ? response.fullText : paragraphText
        return normalized.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func rememberGeneratedTranscript(fingerprint: String? = nil) {
        notesGeneratedForCurrentTranscript = true
        transcriptUpdatedAfterGeneration = false
        lastGeneratedTranscriptFingerprint = fingerprint ?? currentTranscriptFingerprint
    }

    private func markTranscriptUpdatedAfterGenerationIfNeeded() {
        guard notesGeneratedForCurrentTranscript else { return }
        guard enhanceStatus != .running else { return }
        guard let lastGeneratedTranscriptFingerprint else { return }

        let current = currentTranscriptFingerprint
        guard !current.isEmpty else { return }
        transcriptUpdatedAfterGeneration = current != lastGeneratedTranscriptFingerprint
    }

    private func loadTranscript() {
        guard case .reviewing(let recording) = target else { return }
        guard let backend = viewModel.backendClient else { return }
        guard !loadingTranscript else { return }

        loadingTranscript = true
        transcriptError = nil

        Task { @MainActor in
            do {
                let response = try await backend.getNoteTranscript(mediaId: recording.id)
                transcript = response
                if notesGeneratedForCurrentTranscript {
                    rememberGeneratedTranscript(fingerprint: transcriptFingerprint(from: response))
                }
                loadingTranscript = false
            } catch {
                transcriptError = "Transcript isn't ready yet."
                loadingTranscript = false
            }
        }
    }

    private func copyTranscript() {
        let text = transcriptTextForCopy
        guard !text.isEmpty else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        showToast(message: isRecording ? "Live transcript copied" : "Transcript copied")
    }

    private func handleAppear() {
        notesGeneratedForCurrentTranscript = false
        transcriptUpdatedAfterGeneration = false
        lastGeneratedTranscriptFingerprint = nil

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
            loadTranscript()
            Task {
                if let backend = viewModel.backendClient {
                    do {
                        let note = try await backend.getNote(mediaId: recording.id)
                        let enhancement = try? await backend.getEnhancementStatus(mediaId: recording.id)
                        await MainActor.run {
                            reviewBody = note.body ?? ""
                            reviewLastSaved = note.body ?? ""
                            if let templateId = note.templateId {
                                selectedTemplateId = templateId
                            }
                            if let enhancement {
                                applyEnhancementReadiness(enhancement)
                                if enhancement.generationStatus == "complete" {
                                    notesGeneratedForCurrentTranscript = true
                                    if let transcript {
                                        rememberGeneratedTranscript(fingerprint: transcriptFingerprint(from: transcript))
                                    }
                                }
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

    private func applyEnhancementReadiness(_ status: EnhanceStatusResponse) {
        guard status.transcriptReady == false else {
            if enhanceStatus == .failed, enhanceFailureIsRetryable == false {
                enhanceStatus = .idle
                enhanceFailureMessage = nil
                enhanceFailureIsRetryable = true
            }
            transcriptRetryAvailable = false
            transcriptRetrying = false
            return
        }

        enhanceStatus = .failed
        enhanceFailureIsRetryable = false
        transcriptRetryAvailable = false
        if status.mediaStatus == "failed" {
            enhanceFailureMessage = "Recover upload first"
        } else if status.mediaStatus == "uploading" || status.mediaStatus == "transcribing" {
            enhanceFailureMessage = "Waiting for transcript"
        } else if status.canRetryTranscript == true {
            transcriptRetryAvailable = true
            enhanceFailureMessage = status.transcriptState == "empty" ? "Retry transcript" : "Prepare transcript"
        } else if (status.transcriptTextLength ?? 0) == 0 {
            enhanceFailureMessage = "No speech detected"
        } else {
            enhanceFailureMessage = "Waiting for transcript"
        }
    }

    private func handleEnhanceStartFailure(_ error: Error) {
        enhanceStatus = .failed
        enhanceFailureIsRetryable = true

        if let backendError = error as? BackendClientError {
            switch backendError.apiErrorCode {
            case .some("transcript_not_ready"):
                if isRecording {
                    enhanceFailureMessage = "No transcript yet"
                    enhanceFailureIsRetryable = true
                    transcriptRetryAvailable = false
                    showToast(message: "Live transcript is still warming up", tone: .warning)
                    return
                }
                enhanceFailureMessage = "Waiting for transcript"
                enhanceFailureIsRetryable = false
                transcriptRetryAvailable = false
                showToast(message: "Transcript is still being prepared", tone: .warning)
                return
            case .some("transcript_empty"):
                if isRecording {
                    enhanceFailureMessage = "No speech yet"
                    enhanceFailureIsRetryable = true
                    transcriptRetryAvailable = false
                    showToast(message: "No speech captured yet", tone: .warning)
                    return
                }
                enhanceFailureMessage = "Retry transcript"
                enhanceFailureIsRetryable = false
                transcriptRetryAvailable = true
                showToast(message: "Transcript is empty. Try preparing it again.", tone: .warning)
                return
            case .some("unknown_template"):
                enhanceFailureMessage = "Choose a template"
                showToast(message: "Template was not recognized", tone: .error)
                return
            default:
                break
            }

            if backendError.isTransient {
                enhanceFailureMessage = "Server unavailable"
                showToast(message: "Loomola is temporarily unavailable", tone: .warning)
                return
            }
        }

        enhanceFailureMessage = "Try again"
        showToast(message: "Couldn't start AI run", tone: .error)
    }

    private func retryTranscript() {
        guard case .reviewing(let recording) = target else { return }
        guard let backend = viewModel.backendClient else { return }
        guard !transcriptRetrying else { return }

        pollEnhanceTask?.cancel()
        transcriptRetrying = true
        transcriptRetryAvailable = false
        enhanceStatus = .failed
        enhanceFailureIsRetryable = false
        enhanceFailureMessage = "Preparing transcript"
        transcript = nil
        transcriptError = nil

        Task { @MainActor in
            do {
                try await backend.retryNoteTranscript(mediaId: recording.id)
                transcriptRetrying = false
                enhanceFailureMessage = "Waiting for transcript"
                showToast(message: "Transcript retry started")
            } catch {
                transcriptRetrying = false
                transcriptRetryAvailable = true
                enhanceFailureMessage = "Retry transcript"
                showToast(message: "Couldn't retry transcript", tone: .error)
            }
        }
    }

    /// Kicks off a re-run of the AI title + summary pipeline against
    /// the latest transcript + the user's typed notes. Polls every 3s
    /// until the server reports `complete` (or `failed`). On
    /// completion the title and body bindings update in-place so the
    /// editor reflects the new copy without a re-fetch.
    private func startEnhance() {
        guard let backend = viewModel.backendClient else { return }
        guard enhanceStatus != .running else { return }

        let mediaId: String
        let bodyToFlush: String
        let isActiveRecording: Bool
        let shouldPersistStoppedLiveTranscript: Bool
        switch target {
        case .recording:
            guard let activeId = viewModel.activeAudioRecordingId else {
                showToast(message: "Recording is still starting", tone: .warning)
                return
            }
            mediaId = activeId
            bodyToFlush = viewModel.liveNotesBody
            isActiveRecording = true
            shouldPersistStoppedLiveTranscript = false
        case .reviewing(let recording):
            mediaId = recording.id
            bodyToFlush = reviewBody
            isActiveRecording = false
            shouldPersistStoppedLiveTranscript =
                recording.status == "uploading" &&
                viewModel.liveTranscription.hasTranscriptText
        }

        // Flush any pending autosave so the AI run sees the user's
        // latest typed notes (it reads `notes.body` server-side).
        reviewAutosaveTask?.cancel()

        pollEnhanceTask?.cancel()
        enhanceFailureMessage = nil
        enhanceFailureIsRetryable = true
        enhanceStatus = .running

        pollEnhanceTask = Task { @MainActor in
            do {
                if isActiveRecording {
                    _ = await viewModel.flushActiveAudioNoteDraft()
                    _ = await viewModel.persistActiveLiveTranscript()
                } else if bodyToFlush != reviewLastSaved {
                    try? await backend.putNoteBody(mediaId: mediaId, body: bodyToFlush)
                    reviewLastSaved = bodyToFlush
                }
                if shouldPersistStoppedLiveTranscript {
                    _ = await viewModel.persistLiveTranscript(mediaId: mediaId)
                }
                try await backend.enhanceNote(
                    mediaId: mediaId,
                    templateId: selectedTemplateId
                )
            } catch {
                handleEnhanceStartFailure(error)
                return
            }

            // Poll up to 60s @ 3s intervals.
            let deadline = Date().addingTimeInterval(60)
            while Date() < deadline {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled { return }
                guard let status = try? await backend.getEnhancementStatus(mediaId: mediaId) else {
                    continue
                }
                switch status.generationStatus {
                case "complete":
                    if isActiveRecording {
                        viewModel.applyGeneratedAudioNote(
                            title: status.titleSuggested,
                            body: status.summary
                        )
                    } else {
                        if let suggested = status.titleSuggested, !suggested.isEmpty {
                            reviewTitle = suggested
                        }
                        if let summary = status.summary, !summary.isEmpty {
                            reviewBody = summary
                            reviewLastSaved = summary
                        }
                    }
                    if let templateId = status.templateId {
                        selectedTemplateId = templateId
                    }
                    rememberGeneratedTranscript()
                    enhanceStatus = .complete
                    showToast(message: "Notes updated")
                    // Auto-revert pill after a beat so it's
                    // re-runnable.
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                    if !Task.isCancelled { enhanceStatus = .idle }
                    return
                case "failed":
                    enhanceStatus = .failed
                    enhanceFailureMessage = "AI run failed"
                    enhanceFailureIsRetryable = true
                    showToast(message: "AI run failed", tone: .error)
                    return
                default:
                    continue
                }
            }
            // Timeout — tell user to refresh later.
            enhanceStatus = .idle
            showToast(message: "Still running — check back shortly", tone: .warning)
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
    let isVisible: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        let showing = isVisible || hovering

        ZStack {
            Circle()
                .fill(hovering ? DSColor.Bg.subtle.opacity(0.94) : Color.clear)
            if hovering {
                Circle()
                    .strokeBorder(DSColor.Border.subtle.opacity(0.55), lineWidth: 1)
            }
            Image(systemName: "ellipsis")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(hovering ? DSColor.Text.primary.opacity(0.72) : DSColor.Text.tertiary)
                .opacity(showing ? 1 : 0)
        }
            .frame(width: 32, height: 32)
            .contentShape(Circle())
            .overlay {
                MouseDownHitArea(action: action)
                    .clipShape(Circle())
            }
            .onHover { hovering = $0 }
            .animation(LoomolaMotion.quick, value: hovering)
            .animation(LoomolaMotion.quick, value: isVisible)
    }
}

private struct TranscriptToolbarIconButton: View {
    let icon: String
    let help: String
    let isActive: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(isActive ? DSColor.Text.secondary : DSColor.Text.tertiary)
            .frame(width: 28, height: 28)
            .background(
                Circle()
                    .fill((hovering || isActive) ? DSColor.Bg.subtle : Color.clear)
            )
            .contentShape(Circle())
            .overlay {
                ActionHitArea(action: action)
                    .clipShape(Circle())
            }
            .help(help)
            .onHover { hovering = $0 }
            .animation(LoomolaMotion.quick, value: hovering)
            .animation(LoomolaMotion.quick, value: isActive)
    }
}

private struct MouseDownHitArea: NSViewRepresentable {
    let action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeNSView(context: Context) -> MouseDownActionView {
        let view = MouseDownActionView()
        view.action = context.coordinator.performAction
        return view
    }

    func updateNSView(_ view: MouseDownActionView, context: Context) {
        context.coordinator.action = action
        view.action = context.coordinator.performAction
    }

    final class Coordinator {
        var action: () -> Void

        init(action: @escaping () -> Void) {
            self.action = action
        }

        func performAction() {
            action()
        }
    }
}

private final class MouseDownActionView: NSView {
    var action: (() -> Void)?

    override var acceptsFirstResponder: Bool { false }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func mouseDown(with event: NSEvent) {
        action?()
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

private extension String {
    func localizedCaseInsensitiveOccurrenceCount(of needle: String) -> Int {
        guard !needle.isEmpty else { return 0 }
        var count = 0
        var searchRange = startIndex..<endIndex
        while let range = range(
            of: needle,
            options: [.caseInsensitive, .diacriticInsensitive],
            range: searchRange
        ) {
            count += 1
            searchRange = range.upperBound..<endIndex
        }
        return count
    }
}
