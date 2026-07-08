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
    /// Diarized index for batch transcripts — nil for live/full-text
    /// bubbles. Drives the "who is this?" manual-identify fallback.
    var speakerIdx: Int? = nil
}

private struct TranscriptSearchMatch: Identifiable, Equatable {
    let bubbleId: String
    let occurrenceIndex: Int

    var id: String {
        "\(bubbleId)-\(occurrenceIndex)"
    }
}

private enum NoteWorkspaceMenuAction: Equatable {
    case download(NoteExportDownloadKind)
    case dictionary
    case obsidian
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
    let pinChromeToTitlebar: Bool
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
    @State private var showAttendeePicker = false
    @State private var showRowMenu = false
    @State private var menuActionInFlight: NoteWorkspaceMenuAction? = nil
    @State private var loadingBody = false
    @State private var bodyEditorMeasuredHeight: CGFloat = 320
    @FocusState private var bodyFocused: Bool

    @State private var people: [PersonDTO] = []
    @State private var attendeeIds: [String] = []
    @State private var attendeeNameFallbacks: [String: String] = [:]
    @State private var savingAttendees = false

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
    @State private var suppressReviewAutosave = false

    /// Persisted transcript from the server. v1 small win: this is
    /// post-upload/batch transcript, not live streaming yet.
    @State private var transcript: NoteTranscriptResponse? = nil
    @State private var reviewActionItems: [EnhanceActionItemDTO] = []
    @State private var transcriptDrawerOpen = false

    /// AI-enhanced notes (ai_outputs.summary), kept SEPARATE from the
    /// user's raw notes — Granola's "My notes / Enhanced" split. The
    /// enhanced pane is read-only on desktop; web remains the editor
    /// of record for generated content.
    @State private var enhancedBody = ""
    @State private var showEnhanced = false
    @State private var enhancedEditorMeasuredHeight: CGFloat = 320

    /// G-M12 folder suggestion banner state (review mode).
    @State private var folderSuggestionHandled = false
    @State private var acceptingFolderSuggestion = false

    /// G-M13 speaker suggestions for the transcript drawer.
    @State private var speakerAssignments: [SpeakerAssignmentDTO] = []
    @State private var applyingSpeakerSuggestions = false

    /// Stage 16 Today pill: matched/linked calendar event.
    @State private var linkedCalendarEventTitle: String?
    @State private var showCalendarPopover = false
    @State private var todayEvents: [CalendarEventCandidate] = []
    @State private var linkingCalendarEvent = false

    @State private var loadingTranscript = false
    @State private var transcriptError: String? = nil
    @State private var notesGeneratedForCurrentTranscript = false
    @State private var transcriptUpdatedAfterGeneration = false
    @State private var lastGeneratedTranscriptFingerprint: String? = nil
    @State private var transcriptSearchVisible = false
    @State private var transcriptSearchQuery = ""
    @State private var activeTranscriptSearchIndex = 0
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
            return true
        case .running, .complete, .failed:
            return true
        }
    }

    private var reviewHasTranscript: Bool {
        if let transcript,
           !transcript.fullText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return true
        }
        if case .reviewing(let recording) = target {
            return recording.transcriptReady == true
        }
        return false
    }

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

    private var externalPeople: [PersonDTO] {
        people.filter { !$0.isSelf }
    }

    private var attendeeNames: [String] {
        attendeeIds.compactMap { id in
            people.first(where: { $0.id == id })?.displayName ?? attendeeNameFallbacks[id]
        }
    }

    private var attendeeLabel: String {
        if attendeeNames.isEmpty { return "Me" }
        if attendeeNames.count == 1 { return "Me, \(attendeeNames[0])" }
        return "Me, \(attendeeNames[0]) +\(attendeeNames.count - 1)"
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
                    if let suggestion = activeFolderSuggestion {
                        folderSuggestionBanner(suggestion)
                    }
                    pillRow
                    bodyEditor
                    if !isRecording && !reviewActionItems.isEmpty {
                        actionItemsPanel
                    }
                }
                // Cap the readable column at ~600pt and center
                // horizontally so the editor doesn't sprawl across
                // a 1080+pt wide main window. Granola pattern —
                // narrow windows still fill, wide windows give a
                // comfortable reading width with margin.
                .frame(maxWidth: 600, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, DSSpacing.xl)
                .padding(.top, WindowChromeLayout.noteContentTopPadding)
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
                    .frame(maxWidth: 600, alignment: .leading)
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
            noteChromeBar
                .loomolaTitlebarPinned(pinChromeToTitlebar)
        }
        .onContinuousHover { phase in
            switch phase {
            case .active:
                workspaceHovering = true
            case .ended:
                workspaceHovering = false
            }
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

    private var noteChromeBar: some View {
        HStack(alignment: .center) {
            HomeBackButton(action: onClose)
                .help(isRecording ? "Hide" : "Close")

            Spacer()

            // Keep the hit target mounted even when the dots are
            // visually quiet so the menu does not vanish under the
            // pointer before SwiftUI can enter the button hover state.
            GhostEllipsisButton(isVisible: workspaceHovering || showRowMenu) {
                showRowMenu.toggle()
            }
            .popover(isPresented: $showRowMenu, arrowEdge: .top) {
                rowMenu
            }
        }
        .padding(.leading, WindowChromeLayout.noteLeadingPadding)
        .padding(.trailing, WindowChromeLayout.trailingPadding)
        .padding(.top, WindowChromeLayout.topPadding)
        .frame(height: WindowChromeLayout.barHeight + WindowChromeLayout.topPadding, alignment: .top)
        .frame(maxWidth: .infinity, alignment: .top)
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
                    if case .reviewing(let recording) = target {
                        viewModel.openWebNote(slug: recording.slug)
                    }
                }
                Divider().overlay(DSColor.Border.subtle)
                menuItem(
                    label: "Download full meeting .md",
                    icon: "doc.badge.arrow.down",
                    tint: DSColor.Text.primary,
                    isDisabled: menuActionInFlight != nil
                ) {
                    if case .reviewing(let recording) = target {
                        downloadNoteExport(.fullMarkdown, recording: recording)
                    }
                }
                menuItem(
                    label: "Download transcript .md",
                    icon: "doc.text",
                    tint: DSColor.Text.primary,
                    isDisabled: menuActionInFlight != nil || !reviewHasTranscript
                ) {
                    if case .reviewing(let recording) = target {
                        downloadNoteExport(.transcriptMarkdown, recording: recording)
                    }
                }
                menuItem(
                    label: "Download meeting data .json",
                    icon: "curlybraces.square",
                    tint: DSColor.Text.primary,
                    isDisabled: menuActionInFlight != nil
                ) {
                    if case .reviewing(let recording) = target {
                        downloadNoteExport(.json, recording: recording)
                    }
                }
                Divider().overlay(DSColor.Border.subtle)
                menuItem(
                    label: "Apply dictionary & regenerate",
                    icon: "arrow.triangle.2.circlepath",
                    tint: DSColor.State.success,
                    isDisabled: menuActionInFlight != nil || !reviewHasTranscript || enhanceStatus == .running
                ) {
                    if case .reviewing(let recording) = target {
                        applyDictionaryAndRegenerate(recording: recording)
                    }
                }
                menuItem(
                    label: "Save to Obsidian",
                    icon: "externaldrive.badge.arrow.down",
                    tint: DSColor.State.success,
                    isDisabled: menuActionInFlight != nil
                ) {
                    if case .reviewing(let recording) = target {
                        saveNoteToObsidian(recording: recording)
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
        .frame(width: 300)
        .background(DSColor.Bg.surfaceRaised)
    }

    private func menuItem(
        label: String,
        icon: String,
        tint: Color,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        WorkspaceMenuItem(
            label: label,
            icon: icon,
            tint: tint,
            isDisabled: isDisabled,
            action: action
        )
    }

    private var currentBody: String {
        switch target {
        case .recording: return viewModel.liveNotesBody
        case .reviewing: return reviewBody
        }
    }

    private func downloadNoteExport(
        _ kind: NoteExportDownloadKind,
        recording: RecentRecording
    ) {
        guard let backend = viewModel.backendClient else { return }
        showRowMenu = false
        menuActionInFlight = .download(kind)
        showToast(message: "Preparing \(kind.successLabel) download")

        Task { @MainActor in
            defer { menuActionInFlight = nil }
            do {
                let download = try await backend.downloadNoteExport(
                    mediaId: recording.id,
                    kind: kind
                )
                guard let destination = chooseExportDestination(
                    suggestedFilename: download.filename,
                    fileExtension: kind.fileExtension
                ) else {
                    return
                }
                try download.data.write(to: destination, options: [.atomic])
                showToast(message: "Saved \(kind.successLabel) export")
            } catch {
                showToast(message: "Couldn't save \(kind.successLabel)", tone: .error)
            }
        }
    }

    private func chooseExportDestination(
        suggestedFilename: String,
        fileExtension: String
    ) -> URL? {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.nameFieldStringValue = suggestedFilename
        if let type = UTType(filenameExtension: fileExtension) {
            panel.allowedContentTypes = [type]
        }
        return panel.runModal() == .OK ? panel.url : nil
    }

    private func applyDictionaryAndRegenerate(recording: RecentRecording) {
        guard let backend = viewModel.backendClient else { return }
        showRowMenu = false
        menuActionInFlight = .dictionary
        showToast(message: "Applying dictionary")

        Task { @MainActor in
            do {
                let response = try await backend.reapplyDictionary(mediaId: recording.id)
                menuActionInFlight = nil
                guard response.changed else {
                    showToast(message: "No dictionary changes found", tone: .warning)
                    return
                }
                transcript = nil
                transcriptError = nil
                loadTranscript()
                showToast(message: "Dictionary applied; regenerating notes")
                beginPollingEnhancement(mediaId: recording.id, isActiveRecording: false)
            } catch {
                menuActionInFlight = nil
                showToast(message: dictionaryApplyFailureMessage(error), tone: .error)
            }
        }
    }

    private func saveNoteToObsidian(recording: RecentRecording) {
        showRowMenu = false
        menuActionInFlight = .obsidian
        showToast(message: "Saving to Obsidian")

        Task { @MainActor in
            defer { menuActionInFlight = nil }
            do {
                _ = try await viewModel.saveNoteToObsidianNow(mediaId: recording.id)
                showToast(message: "Saved to Obsidian")
            } catch {
                showToast(message: "Couldn't save to Obsidian", tone: .error)
            }
        }
    }

    private func dictionaryApplyFailureMessage(_ error: Error) -> String {
        guard let backendError = error as? BackendClientError else {
            return "Couldn't apply dictionary"
        }
        switch backendError.apiErrorCode {
        case .some("transcript_not_ready"):
            return "Transcript isn't ready yet"
        case .some("enqueue_failed"):
            return "Couldn't restart AI run"
        default:
            return backendError.isTransient ? "Loomola is temporarily unavailable" : "Couldn't apply dictionary"
        }
    }

    // MARK: - Title

    private var titleEditor: some View {
        TextField(titlePlaceholder, text: titleBinding, axis: .vertical)
            .textFieldStyle(.plain)
            .font(.system(size: 30, weight: .medium, design: .serif))
            .foregroundStyle(DSColor.Text.primary)
            .tint(DSColor.Accent.primary)
            .lineSpacing(1.5)
            .lineLimit(1...4)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
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

    // MARK: - Folder suggestion banner (G-M12, Granola pattern)

    /// The suggestion is actionable when the note is unfiled, the AI
    /// suggested a folder that still exists in the user's folder list
    /// (hallucination defense parity with web), and the user hasn't
    /// acted on it in this session.
    private var activeFolderSuggestion: (folderId: String, name: String)? {
        guard case .reviewing(let recording) = target,
              !folderSuggestionHandled,
              folderId == nil,
              let suggestedId = recording.suggestedFolderId,
              let folder = viewModel.recentRecordings.folders.first(where: { $0.id == suggestedId })
        else { return nil }
        return (suggestedId, folder.name)
    }

    private func folderSuggestionBanner(_ suggestion: (folderId: String, name: String)) -> some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(DSColor.Accent.primary)
            Text("Suggested folder")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
            HStack(spacing: 4) {
                Image(systemName: "folder")
                    .font(.system(size: 11))
                Text(suggestion.name)
                    .font(DSFont.Body.sm().weight(.medium))
            }
            .foregroundStyle(DSColor.Text.primary)
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: DSRadius.sm).fill(DSColor.Bg.subtle))
            Spacer()
            Button {
                acceptFolderSuggestion(suggestion)
            } label: {
                HStack(spacing: 4) {
                    Text("Add")
                    Text("⌘↩")
                        .foregroundStyle(DSColor.Text.tertiary)
                }
                .font(DSFont.Body.sm().weight(.medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(DSColor.Accent.primary)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(acceptingFolderSuggestion)
            IconButton(icon: "xmark", size: 22) {
                dismissFolderSuggestion()
            }
            .help("Dismiss suggestion")
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.Accent.primary.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .strokeBorder(DSColor.Accent.primary.opacity(0.25), lineWidth: 1)
        )
    }

    private func acceptFolderSuggestion(_ suggestion: (folderId: String, name: String)) {
        guard case .reviewing(let recording) = target,
              let backend = viewModel.backendClient,
              !acceptingFolderSuggestion
        else { return }
        acceptingFolderSuggestion = true
        Task { @MainActor in
            defer { acceptingFolderSuggestion = false }
            do {
                try await backend.acceptSuggestedFolder(recordingId: recording.id)
                reviewFolderId = suggestion.folderId
                reviewFolderName = suggestion.name
                folderSuggestionHandled = true
                viewModel.recentRecordings.refresh()
                showToast(message: "Filed in \(suggestion.name)")
            } catch {
                showToast(message: "Couldn't file note", tone: .error)
            }
        }
    }

    private func dismissFolderSuggestion() {
        guard case .reviewing(let recording) = target,
              let backend = viewModel.backendClient
        else { return }
        folderSuggestionHandled = true
        Task {
            try? await backend.dismissSuggestedFolder(recordingId: recording.id)
            await MainActor.run { viewModel.recentRecordings.refresh() }
        }
    }

    // MARK: - Pill row

    private var pillRow: some View {
        HStack(spacing: DSSpacing.md) {
            if !enhancedBody.isEmpty {
                notesModePill
            }
            todayPill
            mePill
            folderPill
            templatePill
        }
    }

    /// Granola's "My notes / ✦ Enhanced" switch. Only rendered once an
    /// enhanced version exists; clicking flips between the user's raw
    /// notes (editable) and the AI-generated notes (read-only — web is
    /// the editor of record for generated content).
    private var notesModePill: some View {
        WorkspacePill(
            icon: showEnhanced ? "sparkles" : "text.alignleft",
            label: showEnhanced ? "Enhanced" : "My notes",
            isActive: showEnhanced,
            action: { withAnimation(LoomolaMotion.quick) { showEnhanced.toggle() } }
        )
        .help(showEnhanced ? "Showing AI-enhanced notes — click for your raw notes" : "Showing your raw notes — click for the AI-enhanced version")
    }

    private var todayPill: some View {
        WorkspacePill(
            icon: "calendar",
            label: calendarPillLabel,
            isActive: linkedCalendarEventTitle != nil,
            action: {
                todayEvents = CalendarAttendeeService.shared.eventsToday()
                showCalendarPopover.toggle()
            }
        )
        .help(linkedCalendarEventTitle ?? "Link a calendar event")
        .popover(isPresented: $showCalendarPopover, arrowEdge: .top) {
            calendarEventPopover
        }
    }

    private var calendarPillLabel: String {
        guard let title = linkedCalendarEventTitle, !title.isEmpty else { return "Today" }
        return title.count <= 24 ? title : String(title.prefix(23)) + "…"
    }

    /// Granola's event popover: which event this note belongs to, with
    /// the ability to fix a wrong match or link one after the fact —
    /// linking re-resolves attendees and re-runs speaker suggestions.
    private var calendarEventPopover: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            if let title = linkedCalendarEventTitle {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(DSFont.Body.md().weight(.medium))
                        .foregroundStyle(DSColor.Text.primary)
                    Text("Attendees were added from this event")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                }
            } else {
                Text("No calendar event")
                    .font(DSFont.Body.md().weight(.medium))
                    .foregroundStyle(DSColor.Text.secondary)
            }

            if !CalendarAttendeeService.shared.hasAccess {
                Button("Allow calendar access…") {
                    Task { await CalendarAttendeeService.shared.requestAccess() }
                }
                .buttonStyle(.plain)
                .font(DSFont.Body.sm().weight(.medium))
                .foregroundStyle(DSColor.Accent.primary)
            } else if case .reviewing = target {
                Divider()
                Text(linkedCalendarEventTitle == nil ? "Link an event from today" : "Wrong event? Pick another")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                if todayEvents.isEmpty {
                    Text("No events with attendees today")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                } else {
                    ForEach(Array(todayEvents.enumerated()), id: \.offset) { _, event in
                        Button {
                            linkCalendarEvent(event)
                        } label: {
                            HStack(spacing: DSSpacing.sm) {
                                Text(event.start.formatted(date: .omitted, time: .shortened))
                                    .font(DSFont.Mono.body())
                                    .foregroundStyle(DSColor.Text.tertiary)
                                Text(event.title)
                                    .font(DSFont.Body.sm())
                                    .foregroundStyle(DSColor.Text.primary)
                                    .lineLimit(1)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(linkingCalendarEvent)
                    }
                }
            }
        }
        .padding(DSSpacing.md)
        .frame(width: 300, alignment: .leading)
    }

    private func linkCalendarEvent(_ event: CalendarEventCandidate) {
        guard case .reviewing(let recording) = target,
              let backend = viewModel.backendClient,
              !linkingCalendarEvent
        else { return }
        linkingCalendarEvent = true
        Task { @MainActor in
            defer { linkingCalendarEvent = false }
            do {
                let attendees = CalendarAttendeePicker.dedupedAttendees(of: event)
                let personIds = try await backend.resolveAttendeePersonIds(
                    attendees.map {
                        ResolveAttendeeRequest.Attendee(
                            displayName: $0.displayName,
                            email: $0.email
                        )
                    }
                )
                try await backend.setRecordingAttendees(
                    recordingId: recording.id,
                    personIds: personIds,
                    calendarEventTitle: event.title,
                    calendarEventStartedAt: event.start
                )
                linkedCalendarEventTitle = event.title
                attendeeIds = personIds
                if let list = try? await backend.listPeople() {
                    people = list
                }
                // The server re-enqueued suggest_speakers; refresh so new
                // suggestions surface in the transcript drawer.
                loadSpeakerAssignments()
                viewModel.recentRecordings.refresh()
                showCalendarPopover = false
                showToast(message: "Linked \(event.title) — \(personIds.count) attendee\(personIds.count == 1 ? "" : "s")")
            } catch {
                showToast(message: "Couldn't link event", tone: .error)
            }
        }
    }

    private var mePill: some View {
        WorkspacePill(
            icon: "person.2",
            label: attendeeLabel,
            isActive: !attendeeIds.isEmpty,
            action: { showAttendeePicker.toggle() }
        )
        .help("Attendees")
        .popover(isPresented: $showAttendeePicker, arrowEdge: .top) {
            AttendeePickerPopover(
                people: externalPeople,
                selectedIds: attendeeIds,
                isSaving: savingAttendees,
                onSave: { personIds in
                    showAttendeePicker = false
                    handleAttendeesSelect(personIds: personIds)
                },
                onCreate: { displayName, email in
                    await createAttendeePerson(displayName: displayName, email: email)
                }
            )
        }
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

    private func handleAttendeesSelect(personIds newPersonIds: [String]) {
        var seen = Set<String>()
        let uniqueIds = newPersonIds.filter { seen.insert($0).inserted }
        let previousIds = attendeeIds
        attendeeIds = uniqueIds
        savingAttendees = true

        guard let recordingId = noteId,
              let backend = viewModel.backendClient
        else {
            attendeeIds = previousIds
            savingAttendees = false
            showToast(message: "Attendees will be available after recording starts", tone: .warning)
            return
        }

        Task {
            do {
                let savedIds = try await backend.assignRecordingAttendees(
                    recordingId: recordingId,
                    personIds: uniqueIds
                )
                await MainActor.run {
                    attendeeIds = savedIds
                    savingAttendees = false
                    showToast(message: attendeeIds.isEmpty ? "Attendees cleared" : "Attendees saved")
                }
            } catch {
                await MainActor.run {
                    attendeeIds = previousIds
                    savingAttendees = false
                    showToast(message: "Couldn't save attendees", tone: .error)
                }
            }
        }
    }

    private func createAttendeePerson(displayName: String, email: String?) async -> PersonDTO? {
        guard let backend = viewModel.backendClient else { return nil }
        do {
            let person = try await backend.createPerson(displayName: displayName, email: email)
            await MainActor.run {
                people = [person] + people.filter { $0.id != person.id }
            }
            return person
        } catch {
            return nil
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
            if showEnhanced && !enhancedBody.isEmpty {
                MarkdownTextEditor(
                    text: $enhancedBody,
                    measuredHeight: $enhancedEditorMeasuredHeight,
                    placeholder: "",
                    isFocused: $bodyFocused,
                    isEditable: false
                )
                .frame(height: max(320, enhancedEditorMeasuredHeight))
                .padding(.leading, -5)
            } else {
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
    }

    private var actionItemsPanel: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(spacing: 6) {
                Image(systemName: "checklist")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.Accent.primary)
                Text("Action items")
                    .font(DSFont.Body.sm().weight(.semibold))
                    .foregroundStyle(DSColor.Text.secondary)
                Text("(\(reviewActionItems.count))")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
            }

            VStack(alignment: .leading, spacing: 4) {
                ForEach(reviewActionItems) { item in
                    actionItemRow(item)
                }
            }
        }
        .padding(.top, DSSpacing.sm)
    }

    private func actionItemRow(_ item: EnhanceActionItemDTO) -> some View {
        Button {
            openReviewNoteAt(timestampSec: item.timestampSec)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: DSSpacing.sm) {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DSColor.Accent.primary)
                    .frame(width: 16)
                Text(item.text)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary.opacity(0.86))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: DSSpacing.sm)
                Text(timestampLabel(item.timestampSec))
                    .font(DSFont.Mono.body())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(
                        RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                            .fill(DSColor.Bg.subtle.opacity(0.72))
                    )
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .fill(DSColor.Bg.surface.opacity(0.52))
            )
            .overlay {
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .strokeBorder(DSColor.Border.subtle.opacity(0.64), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .help("Open web note at \(timestampLabel(item.timestampSec))")
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
    /// "Writing notes" with spinner (running) → line-by-line reveal
    /// of the generated body → "Notes updated" check (complete,
    /// ~2.5s) → back to idle. Reads + writes title and body via the
    /// same bindings as the editors so updates reflect immediately
    /// without re-fetching from the server.
    private var generateNotesBar: some View {
        HStack {
            Spacer()
            if enhanceStatus == .running {
                writingNotesBar
                    .frame(maxWidth: 600)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            } else {
                HStack(spacing: DSSpacing.sm) {
                    transcriptTogglePill
                    generateNotesPill
                }
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
                generateActionPill(
                    label: "Generate notes",
                    icon: "sparkles",
                    emphasized: true
                )
            } else {
                generateActionPill(
                    label: "Regenerate notes",
                    icon: "arrow.clockwise",
                    emphasized: false
                )
            }
        case .running:
            EmptyView()
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

    private func generateActionPill(
        label: String,
        icon: String,
        emphasized: Bool
    ) -> some View {
        Button(action: startEnhance) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                Text(label)
                    .font(DSFont.Body.md())
            }
            .foregroundStyle(emphasized ? .white : DSColor.Text.primary)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(
                Capsule().fill(emphasized ? DSColor.State.success : DSColor.Bg.surface)
            )
            .overlay {
                if !emphasized {
                    Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1)
                }
            }
        }
        .buttonStyle(.plain)
        .help("\(label) from transcript and your notes")
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

    private var writingNotesBar: some View {
        HStack(spacing: DSSpacing.md) {
            ProgressView()
                .controlSize(.small)
                .tint(DSColor.State.success)
            Text("Writing notes")
                .font(DSFont.Body.md().weight(.semibold))
                .foregroundStyle(DSColor.State.success)
            Spacer()
        }
        .frame(height: 52)
        .padding(.horizontal, 18)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .fill(DSColor.Bg.surfaceRaised)
        )
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(DSColor.Border.strong.opacity(0.72), lineWidth: 1)
        }
        .dsShadow(.raised)
        .help("Writing generated notes")
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
        ScrollViewReader { proxy in
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
                    // Invited-vs-spoke visibility: diarized voices against
                    // the attendee list (+ you). A mismatch explains why
                    // full name suggestions may not have fired.
                    if !isRecording, distinctSavedSpeakerCount > 1 {
                        Text("· \(distinctSavedSpeakerCount) voices\(attendeeIds.isEmpty ? "" : " · \(attendeeIds.count + 1) expected")")
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.tertiary)
                    }
                    Spacer()
                    Button {
                        withAnimation(LoomolaMotion.medium) {
                            proxy.scrollTo("transcript-bottom", anchor: .bottom)
                        }
                    } label: {
                        // chevron, not arrow.down.to.line — the latter reads
                        // as "download" next to the copy button.
                        Image(systemName: "chevron.down.2")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(DSColor.Text.secondary)
                            .frame(width: 28, height: 28)
                    }
                    .buttonStyle(.plain)
                    .disabled(transcriptTextForCopy.isEmpty)
                    .opacity(transcriptTextForCopy.isEmpty ? 0.45 : 1)
                    .help("Jump to latest")
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
                    transcriptSearchBar(proxy: proxy)
                        .padding(.horizontal, DSSpacing.lg)
                        .padding(.bottom, DSSpacing.sm)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                if !isRecording, !pendingSpeakerSuggestions.isEmpty {
                    speakerSuggestionBar
                        .padding(.horizontal, DSSpacing.lg)
                        .padding(.bottom, DSSpacing.sm)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Group {
                            if isRecording {
                                liveTranscriptContent
                            } else {
                                transcriptContent
                            }
                        }
                        Color.clear
                            .frame(height: 1)
                            .id("transcript-bottom")
                    }
                    .padding(.horizontal, DSSpacing.lg)
                    .padding(.top, DSSpacing.sm)
                    .padding(.bottom, DSSpacing.lg)
                }
                .frame(maxHeight: 300)
            }
            .onChange(of: normalizedTranscriptSearchQuery) { _, _ in
                activeTranscriptSearchIndex = 0
                scrollToActiveTranscriptSearchMatch(proxy: proxy)
            }
            .onChange(of: transcriptSearchMatches.count) { _, count in
                normalizeActiveTranscriptSearchIndex(matchCount: count)
                scrollToActiveTranscriptSearchMatch(proxy: proxy)
            }
            .onChange(of: activeTranscriptSearchIndex) { _, _ in
                scrollToActiveTranscriptSearchMatch(proxy: proxy)
            }
        }
        .background(RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous).fill(DSColor.Bg.surfaceRaised))
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
        .dsShadow(.raised)
        .animation(LoomolaMotion.quick, value: transcriptSearchVisible)
    }

    private func transcriptSearchBar(proxy: ScrollViewProxy) -> some View {
        let matchCount = transcriptSearchMatches.count
        let hasQuery = !normalizedTranscriptSearchQuery.isEmpty
        let hasMatches = matchCount > 0

        return HStack(spacing: DSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
            TextField("Find in transcript", text: $transcriptSearchQuery)
                .textFieldStyle(.plain)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.primary)
                .focused($transcriptSearchFocused)
                .onSubmit {
                    moveTranscriptSearchSelection(delta: 1, proxy: proxy)
                }
            if hasQuery {
                Text(hasMatches ? "\(activeTranscriptSearchOrdinal)/\(matchCount)" : "0/0")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                Button {
                    moveTranscriptSearchSelection(delta: -1, proxy: proxy)
                } label: {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(hasMatches ? DSColor.Text.secondary : DSColor.Text.tertiary.opacity(0.55))
                        .frame(width: 18, height: 18)
                }
                .buttonStyle(.plain)
                .disabled(!hasMatches)
                .help("Previous match")
                Button {
                    moveTranscriptSearchSelection(delta: 1, proxy: proxy)
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(hasMatches ? DSColor.Text.secondary : DSColor.Text.tertiary.opacity(0.55))
                        .frame(width: 18, height: 18)
                }
                .buttonStyle(.plain)
                .disabled(!hasMatches)
                .help("Next match")
                Button {
                    transcriptSearchQuery = ""
                    activeTranscriptSearchIndex = 0
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
        } else if !savedTranscriptBubbles.isEmpty {
            LazyVStack(alignment: .leading, spacing: DSSpacing.md) {
                ForEach(savedTranscriptBubbles) { bubble in
                    transcriptBubble(bubble)
                }
            }
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
            LazyVStack(alignment: .leading, spacing: DSSpacing.md) {
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

    private var savedTranscriptBubbles: [TranscriptDisplayBubble] {
        guard let transcript else { return [] }
        if !transcript.paragraphs.isEmpty {
            return transcript.paragraphs.map { paragraph in
                let source = transcriptSource(forSpeaker: paragraph.speaker)
                return TranscriptDisplayBubble(
                    id: paragraph.id,
                    source: source,
                    speaker: speakerDisplayName(forLabel: paragraph.speaker),
                    text: paragraph.text,
                    isInterim: false,
                    startSec: paragraph.startSec,
                    endSec: paragraph.endSec,
                    speakerIdx: Self.speakerIdx(fromLabel: paragraph.speaker)
                )
            }
        }

        let fullText = transcript.fullText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fullText.isEmpty else { return [] }
        return [
            TranscriptDisplayBubble(
                id: "full-transcript",
                source: nil,
                speaker: nil,
                text: fullText,
                isInterim: false,
                startSec: 0,
                endSec: 0
            )
        ]
    }

    private func transcriptBubble(_ bubble: TranscriptDisplayBubble) -> some View {
        let isMine = bubble.source == .microphone
        let alignment: Alignment = isMine ? .trailing : .leading
        let horizontalAlignment: HorizontalAlignment = isMine ? .trailing : .leading
        let speaker = bubble.speaker?.trimmingCharacters(in: .whitespacesAndNewlines)
        let isSearchMatch = transcriptBubbleMatchesSearch(bubble)
        let activeSearchMatch = activeTranscriptSearchMatch
        let isActiveSearchMatch = activeSearchMatch?.bubbleId == bubble.id

        return HStack(alignment: .bottom, spacing: 0) {
            if isMine { Spacer(minLength: 54) }
            VStack(alignment: horizontalAlignment, spacing: 5) {
                if let speaker, !speaker.isEmpty {
                    if !isRecording, let idx = bubble.speakerIdx, !people.isEmpty {
                        // Never-misattribute fallback: any voice the
                        // pipeline couldn't identify with evidence stays
                        // "Speaker N" — click to say who it is (also
                        // works to fix an accepted name).
                        Menu {
                            Section(speaker.hasPrefix("Speaker ") ? "Who is this?" : "Reassign speaker") {
                                ForEach(identifyCandidates) { person in
                                    Button(person.displayName) {
                                        assignSpeaker(idx: idx, personId: person.id)
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 3) {
                                Text(speaker)
                                    .font(DSFont.Body.sm())
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 7, weight: .semibold))
                            }
                            .foregroundStyle(
                                speaker.hasPrefix("Speaker ")
                                    ? DSColor.Accent.primary.opacity(0.9)
                                    : DSColor.Text.tertiary.opacity(0.9)
                            )
                            .padding(.horizontal, 4)
                        }
                        .menuStyle(.borderlessButton)
                        .menuIndicator(.hidden)
                        .fixedSize()
                    } else {
                        Text(speaker)
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.tertiary.opacity(0.9))
                            .padding(.horizontal, 4)
                    }
                }
                Text(attributedTranscriptText(for: bubble, activeMatch: activeSearchMatch))
                    .font(.system(size: 13, weight: .regular))
                    .lineSpacing(2.5)
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
                                isActiveSearchMatch
                                    ? Color.orange.opacity(0.86)
                                    : isSearchMatch
                                    ? DSColor.Accent.primary.opacity(0.55)
                                    : transcriptBubbleStroke(source: bubble.source),
                                lineWidth: isActiveSearchMatch ? 1.6 : (isSearchMatch ? 1.3 : 1)
                            )
                            .opacity(isSearchMatch || bubble.source == .systemAudio ? 0.75 : 0)
                    }
            }
            .frame(maxWidth: 560, alignment: alignment)
            if !isMine { Spacer(minLength: 54) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .id(transcriptBubbleScrollId(for: bubble.id))
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

    private func attributedTranscriptText(
        for bubble: TranscriptDisplayBubble,
        activeMatch: TranscriptSearchMatch?
    ) -> AttributedString {
        var attributed = AttributedString(bubble.text)
        attributed.foregroundColor = bubble.isInterim
            ? DSColor.Text.secondary.opacity(0.85)
            : DSColor.Text.primary.opacity(0.82)

        let query = normalizedTranscriptSearchQuery
        guard !query.isEmpty else { return attributed }

        let ranges = bubble.text.localizedCaseInsensitiveRanges(of: query)
        for (occurrenceIndex, range) in ranges.enumerated() {
            guard let lower = AttributedString.Index(range.lowerBound, within: attributed),
                  let upper = AttributedString.Index(range.upperBound, within: attributed) else {
                continue
            }
            let isActive = activeMatch?.bubbleId == bubble.id &&
                activeMatch?.occurrenceIndex == occurrenceIndex
            attributed[lower..<upper].backgroundColor = isActive
                ? Color.orange.opacity(0.95)
                : DSColor.Accent.primary.opacity(0.26)
            attributed[lower..<upper].foregroundColor = isActive
                ? Color.black.opacity(0.92)
                : DSColor.Text.primary
        }

        return attributed
    }

    private func transcriptBubbleScrollId(for bubbleId: String) -> String {
        "transcript-bubble-\(bubbleId)"
    }

    private var liveTranscriptWordCount: Int {
        let finalWords = viewModel.liveTranscription.segments.reduce(0) { total, segment in
            total + countWords(in: segment.text)
        }
        let interimWords = viewModel.liveTranscription.interimBySource.values.reduce(0) { total, text in
            total + countWords(in: text)
        }
        return finalWords + interimWords
    }

    private func countWords(in text: String) -> Int {
        text.split { $0.isWhitespace || $0.isNewline }.count
    }

    private var normalizedTranscriptSearchQuery: String {
        transcriptSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var transcriptSearchMatches: [TranscriptSearchMatch] {
        let query = normalizedTranscriptSearchQuery
        guard !query.isEmpty else { return [] }

        var matches: [TranscriptSearchMatch] = []
        for bubble in transcriptSearchBubbles {
            let occurrenceCount = bubble.text.localizedCaseInsensitiveRanges(of: query).count
            guard occurrenceCount > 0 else { continue }
            for occurrenceIndex in 0..<occurrenceCount {
                matches.append(
                    TranscriptSearchMatch(
                        bubbleId: bubble.id,
                        occurrenceIndex: occurrenceIndex
                    )
                )
            }
        }
        return matches
    }

    private var transcriptSearchBubbles: [TranscriptDisplayBubble] {
        if isRecording {
            return liveTranscriptBubbles
        }
        return savedTranscriptBubbles
    }

    private var activeTranscriptSearchMatch: TranscriptSearchMatch? {
        let matches = transcriptSearchMatches
        guard !matches.isEmpty else { return nil }
        return matches[min(activeTranscriptSearchIndex, matches.count - 1)]
    }

    private var activeTranscriptSearchOrdinal: Int {
        let count = transcriptSearchMatches.count
        guard count > 0 else { return 0 }
        return min(activeTranscriptSearchIndex, count - 1) + 1
    }

    private func transcriptBubbleMatchesSearch(_ bubble: TranscriptDisplayBubble) -> Bool {
        let query = normalizedTranscriptSearchQuery
        guard !query.isEmpty else { return false }
        return bubble.text.localizedCaseInsensitiveContains(query)
    }

    private func normalizeActiveTranscriptSearchIndex(matchCount: Int? = nil) {
        let count = matchCount ?? transcriptSearchMatches.count
        if count == 0 {
            activeTranscriptSearchIndex = 0
        } else if activeTranscriptSearchIndex >= count {
            activeTranscriptSearchIndex = count - 1
        } else if activeTranscriptSearchIndex < 0 {
            activeTranscriptSearchIndex = 0
        }
    }

    private func moveTranscriptSearchSelection(delta: Int, proxy: ScrollViewProxy) {
        let count = transcriptSearchMatches.count
        guard count > 0 else { return }
        activeTranscriptSearchIndex = (activeTranscriptSearchIndex + delta + count) % count
        scrollToActiveTranscriptSearchMatch(proxy: proxy)
        transcriptSearchFocused = true
    }

    private func scrollToActiveTranscriptSearchMatch(proxy: ScrollViewProxy) {
        guard let match = activeTranscriptSearchMatch else { return }
        DispatchQueue.main.async {
            withAnimation(LoomolaMotion.medium) {
                proxy.scrollTo(transcriptBubbleScrollId(for: match.bubbleId), anchor: .center)
            }
        }
    }

    private func openTranscriptSearch() {
        if !transcriptDrawerOpen {
            transcriptDrawerOpen = true
            if !isRecording, transcript == nil, !loadingTranscript {
                loadTranscript()
            }
        }
        transcriptSearchVisible = true
        normalizeActiveTranscriptSearchIndex()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            transcriptSearchFocused = true
        }
    }

    private func toggleTranscriptSearch() {
        if transcriptSearchVisible {
            transcriptSearchVisible = false
            transcriptSearchQuery = ""
            activeTranscriptSearchIndex = 0
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
            let message = BackendClient.attachmentUploadFailureMessage(
                error,
                filename: fileURL.lastPathComponent
            )
            showToast(message: message, tone: .error)
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
                clearTranscriptWaitingStateIfReady(response)
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

    /// Granola-style speaker identification bar: names came from the
    /// calendar-attendee match (G-M13 + Stage 11), the transcript below
    /// already previews them, and one click makes them stick.
    private var speakerSuggestionBar: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DSColor.Accent.primary)
            Text(speakerSuggestionSummary)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .lineLimit(1)
                .help(speakerSuggestionEvidenceHelp)
            Spacer()
            if applyingSpeakerSuggestions {
                ProgressView()
                    .controlSize(.small)
            } else {
                Button("Apply names") {
                    applyAllSpeakerSuggestions()
                }
                .buttonStyle(.plain)
                .font(DSFont.Body.sm().weight(.medium))
                .foregroundStyle(DSColor.Accent.primary)
                IconButton(icon: "xmark", size: 20) {
                    dismissAllSpeakerSuggestions()
                }
                .help("Dismiss suggested names")
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.xs)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.Accent.primary.opacity(0.08))
        )
    }

    private var speakerSuggestionSummary: String {
        let names = pendingSpeakerSuggestions.compactMap(personName(for:))
        guard !names.isEmpty else { return "Speaker names suggested" }
        return "Suggested speakers: \(names.joined(separator: ", "))"
    }

    /// Hover detail: the verbatim transcript quotes behind LLM
    /// attributions — the user can judge the evidence before applying.
    private var speakerSuggestionEvidenceHelp: String {
        let lines = pendingSpeakerSuggestions.compactMap { suggestion -> String? in
            guard let name = personName(for: suggestion),
                  let evidence = suggestion.suggestionEvidence,
                  !evidence.isEmpty
            else { return nil }
            return "\(name): “\(evidence)”"
        }
        return lines.isEmpty
            ? "Matched from the calendar attendee list"
            : lines.joined(separator: "\n")
    }

    private var distinctSavedSpeakerCount: Int {
        guard let transcript else { return 0 }
        return Set(transcript.paragraphs.compactMap(\.speaker)).count
    }

    private func loadSpeakerAssignments() {
        guard case .reviewing(let recording) = target else { return }
        guard let backend = viewModel.backendClient else { return }
        Task { @MainActor in
            if let list = try? await backend.speakerAssignments(mediaId: recording.id) {
                speakerAssignments = list
            }
        }
    }

    /// Pending G-M13 suggestions that can be applied in one click
    /// (have a resolved person; not dismissed).
    private var pendingSpeakerSuggestions: [SpeakerAssignmentDTO] {
        speakerAssignments
            .filter { $0.isSuggestion && $0.dismissedAt == nil && $0.personId != nil }
            .sorted { $0.speakerIdx < $1.speakerIdx }
    }

    private func personName(for assignment: SpeakerAssignmentDTO) -> String? {
        if let override = assignment.displayLabelOverride, !override.isEmpty {
            return override
        }
        guard let personId = assignment.personId else { return nil }
        return people.first(where: { $0.id == personId })?.displayName
    }

    static func speakerIdx(fromLabel label: String?) -> Int? {
        guard let label,
              label.hasPrefix("Speaker "),
              let number = Int(label.dropFirst("Speaker ".count))
        else { return nil }
        return number - 1
    }

    /// Maps a batch transcript's "Speaker N" label to an assigned or
    /// suggested person name. Live-provider transcripts keep their
    /// mic/system source mapping.
    private func speakerDisplayName(forLabel label: String?) -> String? {
        if let source = transcriptSource(forSpeaker: label) {
            return source.displayName
        }
        guard let idx = Self.speakerIdx(fromLabel: label) else { return label }
        guard let assignment = speakerAssignments.first(where: {
            $0.speakerIdx == idx && $0.dismissedAt == nil
        }), let name = personName(for: assignment) else {
            return label
        }
        return name
    }

    /// Manual-identify fallback: attendees first, then the rest of the
    /// people library — shown when the user assigns a voice by hand.
    private var identifyCandidates: [PersonDTO] {
        let attendeeSet = Set(attendeeIds)
        return people.sorted { a, b in
            let aAttendee = attendeeSet.contains(a.id)
            let bAttendee = attendeeSet.contains(b.id)
            if aAttendee != bAttendee { return aAttendee }
            return a.displayName.localizedCompare(b.displayName) == .orderedAscending
        }
    }

    private func assignSpeaker(idx: Int, personId: String) {
        guard case .reviewing(let recording) = target,
              let backend = viewModel.backendClient
        else { return }
        Task { @MainActor in
            do {
                try await backend.assignSpeaker(
                    mediaId: recording.id,
                    speakerIdx: idx,
                    personId: personId
                )
                if let list = try? await backend.speakerAssignments(mediaId: recording.id) {
                    speakerAssignments = list
                }
                showToast(message: "Speaker assigned")
            } catch {
                showToast(message: "Couldn't assign speaker", tone: .error)
            }
        }
    }

    private func applyAllSpeakerSuggestions() {
        guard case .reviewing(let recording) = target,
              let backend = viewModel.backendClient,
              !applyingSpeakerSuggestions
        else { return }
        let pending = pendingSpeakerSuggestions
        guard !pending.isEmpty else { return }
        applyingSpeakerSuggestions = true
        Task { @MainActor in
            defer { applyingSpeakerSuggestions = false }
            var applied = 0
            for suggestion in pending {
                guard let personId = suggestion.personId else { continue }
                do {
                    try await backend.acceptSpeakerSuggestion(
                        recordingId: recording.id,
                        speakerIdx: suggestion.speakerIdx,
                        personId: personId
                    )
                    applied += 1
                } catch {
                    // Keep going — a 409 just means that idx was already
                    // accepted or dismissed elsewhere (e.g., on web).
                }
            }
            if let list = try? await backend.speakerAssignments(mediaId: recording.id) {
                speakerAssignments = list
            }
            showToast(message: applied > 0 ? "Speaker names applied" : "Names were already applied")
        }
    }

    private func dismissAllSpeakerSuggestions() {
        guard case .reviewing(let recording) = target,
              let backend = viewModel.backendClient
        else { return }
        let pending = pendingSpeakerSuggestions
        // Optimistic: hide the bar immediately.
        speakerAssignments = speakerAssignments.filter { !$0.isSuggestion }
        Task {
            for suggestion in pending {
                try? await backend.dismissSpeakerSuggestion(
                    recordingId: recording.id,
                    speakerIdx: suggestion.speakerIdx
                )
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
        reviewActionItems = []

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
                    if let list = try? await backend.listPeople() {
                        await MainActor.run { people = list }
                    }
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
            attendeeIds = []
            attendeeNameFallbacks = [:]
        case .reviewing(let recording):
            reviewTitle = recording.title
            reviewFolderId = recording.folderId
            reviewFolderName = recording.folderName
            linkedCalendarEventTitle = recording.calendarEventTitle
            attendeeIds = recording.attendees.map(\.id)
            attendeeNameFallbacks = Dictionary(
                uniqueKeysWithValues: recording.attendees.map { ($0.id, $0.name) }
            )
            reviewBody = ""
            enhancedBody = ""
            showEnhanced = false
            folderSuggestionHandled = false
            speakerAssignments = []
            loadingBody = true
            loadTranscript()
            loadSpeakerAssignments()
            Task {
                if let backend = viewModel.backendClient {
                    do {
                        let note = try await backend.getNote(mediaId: recording.id)
                        let enhancement = try? await backend.getEnhancementStatus(mediaId: recording.id)
                        await MainActor.run {
                            let savedBody = note.body ?? ""
                            let generatedRaw =
                                enhancement?.generationStatus == "complete"
                                ? enhancement?.summary?.trimmingCharacters(in: .whitespacesAndNewlines)
                                : nil
                            let generatedBody = generatedRaw
                                .map(MarkdownDisplayNormalizer.normalizeGeneratedNotes)?
                                .trimmingCharacters(in: .whitespacesAndNewlines)
                            // Raw notes stay in the editable pane; the
                            // enhanced version gets its own read-only pane
                            // (Granola's "My notes / Enhanced" split).
                            // Default to Enhanced when it exists — that's
                            // the note you usually came back to read.
                            reviewBody = savedBody
                            reviewLastSaved = savedBody
                            enhancedBody = generatedBody ?? ""
                            showEnhanced = !(generatedBody ?? "").isEmpty
                            if let templateId = note.templateId {
                                selectedTemplateId = templateId
                            }
                            if let enhancement {
                                applyEnhancementReadiness(enhancement)
                                reviewActionItems = enhancement.actionItems ?? []
                                if enhancement.generationStatus == "complete" {
                                    notesGeneratedForCurrentTranscript = true
                                    if let transcript {
                                        rememberGeneratedTranscript(fingerprint: transcriptFingerprint(from: transcript))
                                    }
                                } else if enhancement.generationStatus == "pending" ||
                                            enhancement.generationStatus == "streaming" {
                                    beginPollingEnhancement(
                                        mediaId: recording.id,
                                        isActiveRecording: false
                                    )
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

    private func clearTranscriptWaitingStateIfReady(_ response: NoteTranscriptResponse) {
        guard !response.fullText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        guard enhanceStatus == .failed, enhanceFailureIsRetryable == false else {
            transcriptRetryAvailable = false
            transcriptRetrying = false
            return
        }

        enhanceStatus = .idle
        enhanceFailureMessage = nil
        enhanceFailureIsRetryable = true
        transcriptRetryAvailable = false
        transcriptRetrying = false
    }

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
        if status.canRetryTranscript == true {
            transcriptRetryAvailable = true
            enhanceFailureMessage = transcriptRecoveryMessage(
                failureReason: status.failureReason,
                transcriptState: status.transcriptState
            )
        } else if status.mediaStatus == "failed" {
            enhanceFailureMessage = "Recover upload first"
        } else if status.mediaStatus == "uploading" || status.mediaStatus == "transcribing" {
            enhanceFailureMessage = "Waiting for transcript"
        } else if (status.transcriptTextLength ?? 0) == 0 {
            enhanceFailureMessage = "No speech detected"
        } else {
            enhanceFailureMessage = "Waiting for transcript"
        }
    }

    private func handleEnhanceStartFailure(_ error: Error) {
        enhanceStatus = .failed
        enhanceFailureIsRetryable = true

        if RecorderViewModel.isAuthRefreshFailure(error) {
            enhanceFailureMessage = "Sign in again"
            enhanceFailureIsRetryable = false
            transcriptRetryAvailable = false
            showToast(message: "Session expired. Transcript is saved locally; sign in again.", tone: .error)
            return
        }

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
            case .some("transcript_failed"):
                let reason = backendError.apiErrorMessage
                enhanceFailureMessage = transcriptRecoveryMessage(
                    failureReason: reason,
                    transcriptState: nil
                )
                enhanceFailureIsRetryable = false
                transcriptRetryAvailable = backendError.apiCanRetryTranscript
                showToast(
                    message: transcriptRecoveryToastMessage(failureReason: reason),
                    tone: .error
                )
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

    private func transcriptRecoveryMessage(
        failureReason: String?,
        transcriptState: String?
    ) -> String {
        let reason = failureReason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let lower = reason.lowercased()
        if lower.contains("deepgram") &&
            (lower.contains("credit") || lower.contains("402") || lower.contains("payment required")) {
            return "Add Deepgram credits, then retry"
        }
        if lower.contains("openai") &&
            (lower.contains("credit") || lower.contains("quota") || lower.contains("insufficient_quota")) {
            return "Add OpenAI credits, then retry"
        }
        if !reason.isEmpty {
            return "Transcript failed - retry"
        }
        return transcriptState == "empty" ? "Retry transcript" : "Prepare transcript"
    }

    private func transcriptRecoveryToastMessage(failureReason: String?) -> String {
        let reason = failureReason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if reason.isEmpty {
            return "Transcript failed. Audio is safe - retry after fixing the issue."
        }
        return "\(reason) Audio is safe - retry after fixing the issue."
    }

    private func beginPollingEnhancement(
        mediaId: String,
        isActiveRecording: Bool
    ) {
        guard enhanceStatus != .running else { return }
        pollEnhanceTask?.cancel()
        enhanceFailureMessage = nil
        enhanceFailureIsRetryable = true
        transcriptRetryAvailable = false
        transcriptRetrying = false
        enhanceStatus = .running
        pollEnhanceTask = Task { @MainActor in
            await pollEnhancementUntilComplete(
                mediaId: mediaId,
                isActiveRecording: isActiveRecording
            )
        }
    }

    private func pollEnhancementUntilComplete(
        mediaId: String,
        isActiveRecording: Bool
    ) async {
        guard let backend = viewModel.backendClient else {
            enhanceStatus = .idle
            return
        }

        var attempt = 0
        var showedSlowRunToast = false
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: enhancementPollDelayNanoseconds(attempt: attempt))
            if Task.isCancelled { return }
            attempt += 1

            if !showedSlowRunToast && attempt == 40 {
                showedSlowRunToast = true
                showToast(message: "Still generating — I'll keep watching", tone: .warning)
            }

            guard let status = try? await backend.getEnhancementStatus(mediaId: mediaId) else {
                continue
            }

            switch status.generationStatus {
            case "complete":
                let hasSummary =
                    !(status.summary?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
                guard hasSummary else { continue }
                await applyGeneratedNotesResult(status, isActiveRecording: isActiveRecording)
                if !isActiveRecording {
                    reviewActionItems = status.actionItems ?? []
                }
                if let templateId = status.templateId {
                    selectedTemplateId = templateId
                }
                rememberGeneratedTranscript()
                enhanceStatus = .complete
                showToast(message: "Notes updated")
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
    }

    private func enhancementPollDelayNanoseconds(attempt: Int) -> UInt64 {
        if attempt < 80 {
            return 1_500_000_000
        }
        if attempt < 176 {
            return 5_000_000_000
        }
        return 15_000_000_000
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
    /// the latest transcript + the user's typed notes. Polls with a
    /// short interval until the server reports `complete` (or
    /// `failed`). On completion the title and body bindings update
    /// in-place so the editor reflects the new copy without a
    /// re-fetch.
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

            await pollEnhancementUntilComplete(
                mediaId: mediaId,
                isActiveRecording: isActiveRecording
            )
        }
    }

    private func applyGeneratedNotesResult(
        _ status: EnhanceStatusResponse,
        isActiveRecording: Bool
    ) async {
        if isActiveRecording {
            viewModel.applyGeneratedAudioNote(title: status.titleSuggested, body: nil)
        } else if let suggested = status.titleSuggested,
                  !suggested.isEmpty,
                  reviewTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            reviewTitle = suggested
        }

        guard let rawSummary = status.summary, !rawSummary.isEmpty else { return }
        let summary = MarkdownDisplayNormalizer.normalizeGeneratedNotes(rawSummary)
        // Generated notes land in the ENHANCED pane; the user's raw notes
        // (reviewBody / liveNotesBody) are never overwritten — they used
        // to be, which silently destroyed the raw notes on the next
        // autosave.
        withAnimation(LoomolaMotion.quick) { showEnhanced = true }
        await revealGeneratedNotesBody(summary, isActiveRecording: isActiveRecording)
    }

    private func revealGeneratedNotesBody(
        _ finalBody: String,
        isActiveRecording: Bool
    ) async {
        let lines = finalBody.components(separatedBy: "\n")
        let nonEmptyLineCount = max(
            1,
            lines.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
        )
        let secondsPerLine = min(0.09, max(0.025, 4.5 / Double(nonEmptyLineCount)))
        var nextBody = ""

        if !isActiveRecording {
            suppressReviewAutosave = true
        }
        defer {
            if !isActiveRecording {
                suppressReviewAutosave = false
            }
        }

        updateDisplayedBody("", isActiveRecording: isActiveRecording)

        for index in lines.indices {
            if Task.isCancelled { return }
            if index > 0 { nextBody += "\n" }
            nextBody += lines[index]
            withAnimation(.linear(duration: 0.05)) {
                updateDisplayedBody(nextBody, isActiveRecording: isActiveRecording)
            }
            let trimmed = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
            let delay = trimmed.isEmpty ? 25_000_000 : UInt64(secondsPerLine * 1_000_000_000)
            try? await Task.sleep(nanoseconds: delay)
        }

        updateDisplayedBody(finalBody, isActiveRecording: isActiveRecording)
    }

    private func updateDisplayedBody(_ body: String, isActiveRecording: Bool) {
        enhancedBody = body
    }

    private func scheduleReviewAutosave(_ next: String) {
        guard case .reviewing(let recording) = target else { return }
        guard !loadingBody else { return }
        guard !suppressReviewAutosave else { return }
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

    private func timestampLabel(_ seconds: Double) -> String {
        elapsedString(seconds: max(0, seconds))
    }

    private func openReviewNoteAt(timestampSec: Double) {
        guard case .reviewing(let recording) = target else { return }
        viewModel.openWebNote(slug: recording.slug, timestampSec: timestampSec)
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

private struct AttendeePickerPopover: View {
    let people: [PersonDTO]
    let selectedIds: [String]
    let isSaving: Bool
    let onSave: ([String]) -> Void
    let onCreate: (String, String?) async -> PersonDTO?

    @State private var query = ""
    @State private var draftIds: [String]
    @State private var newName = ""
    @State private var newEmail = ""
    @State private var creating = false
    @State private var createFailed = false
    @FocusState private var searchFocused: Bool

    init(
        people: [PersonDTO],
        selectedIds: [String],
        isSaving: Bool,
        onSave: @escaping ([String]) -> Void,
        onCreate: @escaping (String, String?) async -> PersonDTO?
    ) {
        self.people = people
        self.selectedIds = selectedIds
        self.isSaving = isSaving
        self.onSave = onSave
        self.onCreate = onCreate
        _draftIds = State(initialValue: selectedIds)
    }

    private var filteredPeople: [PersonDTO] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let sorted = people.sorted { $0.displayName.localizedCompare($1.displayName) == .orderedAscending }
        if trimmed.isEmpty { return sorted }
        return sorted.filter {
            $0.displayName.localizedCaseInsensitiveContains(trimmed) ||
            ($0.email ?? "").localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            lockedSelfRow
            Divider().overlay(DSColor.Border.subtle)
            searchField
            Divider().overlay(DSColor.Border.subtle)
            peopleList
            Divider().overlay(DSColor.Border.subtle)
            createPersonSection
            Divider().overlay(DSColor.Border.subtle)
            footer
        }
        .frame(width: 320)
        .background(DSColor.Bg.surfaceRaised)
        .onAppear { searchFocused = true }
    }

    private var lockedSelfRow: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "person.fill")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
                .frame(width: 16)
            Text("Me")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
            Spacer()
            Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(DSColor.Accent.primary)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
    }

    private var searchField: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
            TextField("Search people", text: $query)
                .textFieldStyle(.plain)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .focused($searchFocused)
                .tint(DSColor.Accent.primary)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(DSColor.Text.tertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
    }

    private var peopleList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if filteredPeople.isEmpty {
                    Text("No people found")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.vertical, DSSpacing.sm)
                } else {
                    ForEach(filteredPeople) { person in
                        attendeeRow(person)
                    }
                }
            }
            .padding(.vertical, DSSpacing.xs)
        }
        .frame(maxHeight: 240)
    }

    private func attendeeRow(_ person: PersonDTO) -> some View {
        let selected = draftIds.contains(person.id)
        return HStack(spacing: DSSpacing.sm) {
            Image(systemName: selected ? "checkmark.square.fill" : "square")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(selected ? DSColor.Accent.primary : DSColor.Text.tertiary)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(person.displayName)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(1)
                if let email = person.email, !email.isEmpty {
                    Text(email)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                        .lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .contentShape(Rectangle())
        .onTapGesture {
            if selected {
                draftIds.removeAll { $0 == person.id }
            } else {
                draftIds.append(person.id)
            }
        }
    }

    private var createPersonSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(spacing: DSSpacing.sm) {
                TextField("Name", text: $newName)
                    .textFieldStyle(.plain)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .tint(DSColor.Accent.primary)
                TextField("Email", text: $newEmail)
                    .textFieldStyle(.plain)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .tint(DSColor.Accent.primary)
                Button {
                    createPerson()
                } label: {
                    Image(systemName: creating ? "hourglass" : "plus.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(DSColor.Accent.primary)
                .disabled(creating || newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if createFailed {
                Text("Could not add person")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.State.danger)
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
    }

    private var footer: some View {
        HStack {
            Spacer()
            Button("Save") {
                onSave(draftIds)
            }
            .buttonStyle(.plain)
            .font(DSFont.Body.md())
            .foregroundStyle(isSaving ? DSColor.Text.tertiary : DSColor.Accent.primary)
            .disabled(isSaving || creating)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
    }

    private func createPerson() {
        let displayName = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        let email = newEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !displayName.isEmpty else { return }
        creating = true
        createFailed = false
        Task {
            let person = await onCreate(displayName, email.isEmpty ? nil : email)
            await MainActor.run {
                creating = false
                guard let person else {
                    createFailed = true
                    return
                }
                if !draftIds.contains(person.id) {
                    draftIds.append(person.id)
                }
                newName = ""
                newEmail = ""
                query = ""
            }
        }
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
    let isDisabled: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        let effectiveTint = isDisabled ? DSColor.Text.tertiary : tint

        HStack(spacing: DSSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(effectiveTint)
                .frame(width: 16)
            Text(label)
                .font(DSFont.Body.md())
                .foregroundStyle(effectiveTint)
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(!isDisabled && hovering ? DSColor.Bg.subtle : Color.clear)
        .contentShape(Rectangle())
        .overlay {
            if !isDisabled {
                ActionHitArea(action: action)
            }
        }
        .onHover { hovering = !isDisabled && $0 }
    }
}

private extension String {
    func localizedCaseInsensitiveRanges(of needle: String) -> [Range<String.Index>] {
        guard !needle.isEmpty else { return [] }
        var ranges: [Range<String.Index>] = []
        var searchRange = startIndex..<endIndex
        while let range = range(
            of: needle,
            options: [.caseInsensitive, .diacriticInsensitive],
            range: searchRange
        ) {
            ranges.append(range)
            searchRange = range.upperBound..<endIndex
        }
        return ranges
    }
}
