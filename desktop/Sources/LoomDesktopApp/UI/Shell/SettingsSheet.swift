import AppKit
import SwiftUI

/// Sheet presented from the title-bar gear icon. Houses Sources,
/// Permissions (when missing), Integrations, Diagnostics, and Account.
/// All actions route to the existing view-model methods so behavior
/// matches what the legacy MainRecorderView footer + integration card
/// did in M2.
struct SettingsSheet: View {
    let onDismiss: () -> Void

    @EnvironmentObject private var viewModel: RecorderViewModel
    @ObservedObject private var orphanStore = OrphanedRecordingStore.shared
    @State private var permissionStatus: PermissionStatus = PermissionChecker.currentStatus()
    @State private var diagnosticsExpanded = false
    @State private var preferences = UserPreferencesDTO.defaults
    @State private var preferencesStatus: String?
    @State private var serverVersion: ServerVersionResponse?
    @State private var serverVersionStatus: String = "Not checked"
    @State private var isCheckingServerVersion = false
    @State private var sourceRefreshStatus: String?
    @State private var isRefreshingSources = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(DSColor.Border.subtle)
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.xxl) {
                    sourcesSection
                    preferencesSection
                    if permissionStatus.requiredMissing || permissionStatus.camera == .denied
                        || permissionStatus.microphone == .denied
                        || permissionStatus.screenRecording == .denied
                    {
                        permissionsSection
                    }
                    integrationsSection
                    notificationsSection
                    if !orphanStore.orphans.isEmpty {
                        recoverySection
                    }
                    accountSection
                    diagnosticsSection
                }
                .padding(.horizontal, DSSpacing.xxl)
                .padding(.vertical, DSSpacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(width: 580, height: 620)
        .background(DSColor.Bg.surface)
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in
            permissionStatus = PermissionChecker.currentStatus()
        }
        .task {
            await loadPreferences()
            await checkServerVersion()
        }
    }

    private var header: some View {
        HStack(spacing: DSSpacing.md) {
            Text("Settings")
                .font(DSFont.Display.lg())
                .foregroundStyle(DSColor.Text.primary)
            Spacer()
            IconButton(icon: "xmark", size: 30, action: onDismiss)
        }
        .padding(.horizontal, DSSpacing.xxl)
        .padding(.vertical, DSSpacing.lg)
    }

    // MARK: - Preferences

    private var preferencesSection: some View {
        Section(title: "Preferences", subtitle: "Granola-style meeting defaults.") {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                settingsToggleRow(
                    title: "Meeting detection",
                    subtitle: "Watch for Meet, Zoom, Teams, and Webex context.",
                    isOn: Binding(
                        get: { preferences.meetingDetectionEnabled },
                        set: { enabled in
                            preferences.meetingDetectionEnabled = enabled
                            viewModel.setMeetingDetectionEnabled(enabled)
                            savePreferences(
                                UpdateUserPreferencesRequest(meetingDetectionEnabled: enabled)
                            )
                        }
                    )
                )
                settingsToggleRow(
                    title: "Live recording indicator",
                    subtitle: "Show the floating pill while audio notes are recording.",
                    isOn: Binding(
                        get: { preferences.floatingRecordingIndicatorEnabled },
                        set: { enabled in
                            preferences.floatingRecordingIndicatorEnabled = enabled
                            viewModel.setFloatingRecordingIndicatorEnabled(enabled)
                            savePreferences(
                                UpdateUserPreferencesRequest(
                                    floatingRecordingIndicatorEnabled: enabled
                                )
                            )
                        }
                    )
                )
                settingsToggleRow(
                    title: "Live transcription",
                    subtitle: "Send audio to Deepgram while recording so transcripts are ready immediately.",
                    isOn: Binding(
                        get: { viewModel.liveTranscriptionEnabled },
                        set: { enabled in
                            viewModel.setLiveTranscriptionEnabled(enabled)
                        }
                    )
                )
                FieldPicker(
                    label: "Transcription language",
                    placeholder: "English",
                    icon: "waveform",
                    options: transcriptionLanguageOptions,
                    selection: Binding(
                        get: { preferences.transcriptionLanguage },
                        set: { value in
                            guard let value else { return }
                            preferences.transcriptionLanguage = value
                            savePreferences(
                                UpdateUserPreferencesRequest(transcriptionLanguage: value)
                            )
                        }
                    )
                )
                FieldPicker(
                    label: "Summary language",
                    placeholder: "Same as transcript",
                    icon: "text.bubble",
                    options: summaryLanguageOptions,
                    selection: Binding(
                        get: { preferences.summaryLanguage },
                        set: { value in
                            guard let value else { return }
                            preferences.summaryLanguage = value
                            savePreferences(
                                UpdateUserPreferencesRequest(summaryLanguage: value)
                            )
                        }
                    )
                )
                FieldPicker(
                    label: "Transcript retention",
                    placeholder: "Policy saved; cleanup next",
                    icon: "archivebox",
                    options: transcriptRetentionOptions,
                    selection: Binding(
                        get: { retentionSelection },
                        set: { value in
                            guard let value else { return }
                            preferences.transcriptRetentionDays = value == "forever"
                                ? nil
                                : Int(value)
                            savePreferences(
                                UpdateUserPreferencesRequest(
                                    transcriptRetentionDays: preferences.transcriptRetentionDays,
                                    encodeTranscriptRetentionDays: true
                                )
                            )
                        }
                    )
                )
                if let preferencesStatus {
                    Text(preferencesStatus)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                }
            }
        }
    }

    private var notificationsSection: some View {
        Section(title: "Notifications", subtitle: "Email preferences for shared recordings.") {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                settingsToggleRow(
                    title: "First view emails",
                    subtitle: "Notify when a new visitor opens a shared recording.",
                    isOn: Binding(
                        get: { preferences.notifyFirstView },
                        set: { enabled in
                            preferences.notifyFirstView = enabled
                            savePreferences(
                                UpdateUserPreferencesRequest(notifyFirstView: enabled)
                            )
                        }
                    )
                )
                settingsToggleRow(
                    title: "Comment emails",
                    subtitle: "Notify when someone comments on a shared recording.",
                    isOn: Binding(
                        get: { preferences.notifyComments },
                        set: { enabled in
                            preferences.notifyComments = enabled
                            savePreferences(
                                UpdateUserPreferencesRequest(notifyComments: enabled)
                            )
                        }
                    )
                )
                settingsToggleRow(
                    title: "Product updates",
                    subtitle: "Reserved for occasional Loomola product notes.",
                    isOn: Binding(
                        get: { preferences.notifyMarketing },
                        set: { enabled in
                            preferences.notifyMarketing = enabled
                            savePreferences(
                                UpdateUserPreferencesRequest(notifyMarketing: enabled)
                            )
                        }
                    )
                )
            }
        }
    }

    // MARK: - Sources

    private var sourcesSection: some View {
        Section(title: "Sources", subtitle: "Choose which audio and video sources Loomola records.") {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                FieldPicker(
                    label: "Camera",
                    placeholder: "System default",
                    icon: "camera",
                    options: viewModel.captureSources.cameras.map { .init(id: $0.id, title: $0.name) },
                    selection: Binding(
                        get: { viewModel.selectedCameraDeviceID },
                        set: { viewModel.setSelectedCameraDevice(id: $0) }
                    )
                )
                FieldPicker(
                    label: "Microphone",
                    placeholder: "System default",
                    icon: "mic",
                    options: viewModel.captureSources.microphones.map { .init(id: $0.id, title: $0.name) },
                    selection: Binding(
                        get: { viewModel.selectedMicDeviceID },
                        set: { viewModel.setSelectedMicDevice(id: $0) }
                    )
                )
                FieldPicker(
                    label: "System audio capture",
                    placeholder: "System audio",
                    icon: "speaker.wave.2",
                    options: systemAudioCaptureOptions,
                    selection: Binding(
                        get: { viewModel.systemAudioCaptureMode },
                        set: { mode in
                            guard let mode else { return }
                            viewModel.setSystemAudioCaptureMode(mode)
                        }
                    )
                )
                if viewModel.systemAudioCaptureMode == .audioDevice {
                    FieldPicker(
                        label: "System audio device",
                        placeholder: "Choose virtual audio device",
                        icon: "slider.horizontal.3",
                        options: viewModel.captureSources.microphones.map {
                            .init(id: $0.id, title: $0.name)
                        },
                        selection: Binding(
                            get: { viewModel.selectedSystemAudioDeviceID },
                            set: { viewModel.setSelectedSystemAudioDevice(id: $0) }
                        )
                    )
                    Text("Use a virtual input such as BlackHole or Loopback when SoundSource should keep controlling playback volume.")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else if viewModel.systemAudioCaptureMode == .coreAudioTap {
                    Text("Uses Apple's Core Audio Tap so meeting audio keeps playing through your normal Mac output.")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("ScreenCaptureKit audio is hidden by default because it can change live call playback volume on some setups.")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.State.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    if let sourceRefreshStatus {
                        Text(sourceRefreshStatus)
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.tertiary)
                            .lineLimit(2)
                    }
                    Spacer()
                    SecondaryButton(
                        isRefreshingSources ? "Refreshing..." : "Refresh sources",
                        icon: "arrow.clockwise"
                    ) {
                        refreshSourcesFromSettings()
                    }
                    .disabled(isRefreshingSources)
                }
            }
        }
    }

    // MARK: - Permissions

    private var permissionsSection: some View {
        Section(title: "Permissions", subtitle: "macOS access Loomola needs to record.") {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                permissionRow(
                    title: "Camera",
                    state: permissionStatus.camera,
                    onOpen: { PermissionChecker.openSystemSettings(for: .camera) }
                )
                permissionRow(
                    title: "Microphone",
                    state: permissionStatus.microphone,
                    onOpen: { PermissionChecker.openSystemSettings(for: .microphone) }
                )
                permissionRow(
                    title: "Screen recording",
                    state: permissionStatus.screenRecording,
                    onOpen: { PermissionChecker.openSystemSettings(for: .screenRecording) }
                )
                permissionRow(
                    title: "Accessibility (optional)",
                    state: permissionStatus.accessibility,
                    onOpen: { PermissionChecker.openSystemSettings(for: .accessibility) }
                )
            }
        }
    }

    private func permissionRow(
        title: String,
        state: PermissionStatus.State,
        onOpen: @escaping () -> Void
    ) -> some View {
        HStack(spacing: DSSpacing.md) {
            Text(title)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Pill(pillTitle(state), kind: pillKind(state))
            if state != .granted {
                SecondaryButton("Open Settings", icon: "gear", action: onOpen)
            }
        }
        .padding(.vertical, DSSpacing.xs)
    }

    private func pillTitle(_ state: PermissionStatus.State) -> String {
        switch state {
        case .granted: return "Granted"
        case .denied: return "Denied"
        case .notDetermined: return "Not asked"
        }
    }

    private func pillKind(_ state: PermissionStatus.State) -> Pill.Kind {
        switch state {
        case .granted: return .success
        case .denied: return .recording
        case .notDetermined: return .warning
        }
    }

    // MARK: - Integrations

    private var integrationsSection: some View {
        Section(title: "Integrations", subtitle: "Bridges into your everyday workflow.") {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                integrationRow(
                    title: "Chrome bridge",
                    status: viewModel.nativeMessagingStatus,
                    primary: ("Install", "bolt.horizontal", { viewModel.installNativeMessagingHost() }),
                    primaryDisabled: viewModel.isInstallingNativeMessagingHost,
                    secondary: ("Open extension folder", "folder", { viewModel.openExtensionFolder() })
                )
                Divider().overlay(DSColor.Border.subtle)
                integrationRow(
                    title: "Obsidian",
                    status: "Realtime sync with polling backup.",
                    primary: ("Sync now", "arrow.triangle.2.circlepath", { viewModel.syncPendingObsidianNotes() }),
                    primaryDisabled: false,
                    secondary: nil
                )
            }
        }
    }

    private func integrationRow(
        title: String,
        status: String,
        primary: (String, String, () -> Void),
        primaryDisabled: Bool,
        secondary: (String, String, () -> Void)?
    ) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text(title)
                .font(DSFont.Body.lg())
                .foregroundStyle(DSColor.Text.primary)
            Text(status)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .lineLimit(2)
            HStack(spacing: DSSpacing.sm) {
                PrimaryButton(primary.0, icon: primary.1, action: primary.2)
                    .disabled(primaryDisabled)
                if let secondary {
                    SecondaryButton(secondary.0, icon: secondary.1, action: secondary.2)
                }
            }
        }
    }

    private func settingsToggleRow(
        title: String,
        subtitle: String,
        isOn: Binding<Bool>
    ) -> some View {
        HStack(spacing: DSSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text(subtitle)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
                    .lineLimit(2)
            }
            Spacer()
            Toggle("", isOn: isOn)
                .labelsHidden()
                .toggleStyle(.switch)
        }
    }

    private var transcriptionLanguageOptions: [FieldPicker<String>.Option<String>] {
        [
            .init(id: "auto", title: "Auto-detect"),
            .init(id: "en", title: "English"),
            .init(id: "es", title: "Spanish"),
            .init(id: "fr", title: "French"),
            .init(id: "de", title: "German"),
            .init(id: "it", title: "Italian"),
            .init(id: "pt", title: "Portuguese"),
            .init(id: "nl", title: "Dutch"),
            .init(id: "hi", title: "Hindi"),
            .init(id: "ja", title: "Japanese"),
            .init(id: "ko", title: "Korean"),
            .init(id: "zh", title: "Chinese")
        ]
    }

    private var summaryLanguageOptions: [FieldPicker<String>.Option<String>] {
        [
            .init(id: "same-as-transcript", title: "Same as transcript"),
            .init(id: "en", title: "English"),
            .init(id: "es", title: "Spanish"),
            .init(id: "fr", title: "French"),
            .init(id: "de", title: "German"),
            .init(id: "it", title: "Italian"),
            .init(id: "pt", title: "Portuguese"),
            .init(id: "nl", title: "Dutch"),
            .init(id: "hi", title: "Hindi"),
            .init(id: "ja", title: "Japanese"),
            .init(id: "ko", title: "Korean"),
            .init(id: "zh", title: "Chinese")
        ]
    }

    private var transcriptRetentionOptions: [FieldPicker<String>.Option<String>] {
        [
            .init(id: "forever", title: "Forever"),
            .init(id: "30", title: "30 days"),
            .init(id: "90", title: "90 days"),
            .init(id: "365", title: "1 year")
        ]
    }

    private var systemAudioCaptureOptions: [FieldPicker<SystemAudioCaptureMode>.Option<SystemAudioCaptureMode>] {
        RecorderViewModel.systemAudioCaptureModesForSettings.map {
            .init(id: $0, title: "\($0.title) · \($0.detail)")
        }
    }

    private var retentionSelection: String {
        preferences.transcriptRetentionDays.map(String.init) ?? "forever"
    }

    private func refreshSourcesFromSettings() {
        isRefreshingSources = true
        sourceRefreshStatus = "Refreshing..."
        viewModel.refreshCaptureSources()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 700_000_000)
            isRefreshingSources = false
            sourceRefreshStatus = "Found \(viewModel.captureSources.cameras.count) camera(s) and \(viewModel.captureSources.microphones.count) audio device(s)."
        }
    }

    private func loadPreferences() async {
        guard let backend = viewModel.backendClient else { return }
        do {
            let response = try await backend.getUserPreferences()
            preferences = response.preferences
            viewModel.setMeetingDetectionEnabled(response.preferences.meetingDetectionEnabled)
            viewModel.setFloatingRecordingIndicatorEnabled(
                response.preferences.floatingRecordingIndicatorEnabled
            )
            preferencesStatus = nil
        } catch {
            preferencesStatus = "Preferences unavailable: \(error.localizedDescription)"
        }
    }

    private func savePreferences(_ request: UpdateUserPreferencesRequest) {
        guard let backend = viewModel.backendClient else { return }
        preferencesStatus = "Saving..."
        Task {
            do {
                let response = try await backend.updateUserPreferences(request)
                await MainActor.run {
                    preferences = response.preferences
                    preferencesStatus = "Saved."
                }
            } catch {
                await MainActor.run {
                    preferencesStatus = "Save failed: \(error.localizedDescription)"
                }
            }
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        Section(title: "Account", subtitle: nil) {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                if !viewModel.email.isEmpty {
                    HStack {
                        Text("Signed in as")
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.secondary)
                        Text(viewModel.email)
                            .font(DSFont.Body.md())
                            .foregroundStyle(DSColor.Text.primary)
                    }
                }
                HStack(spacing: DSSpacing.sm) {
                    SecondaryButton("Open library", icon: "rectangle.stack") {
                        if let url = URL(string: "https://loom.dissonance.cloud") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                    SecondaryButton("Sign out", icon: "rectangle.portrait.and.arrow.right") {
                        onDismiss()
                        viewModel.signOut()
                    }
                }
                Text(BuildStamp.displayString)
                    .font(DSFont.Mono.body())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .padding(.top, DSSpacing.xs)
            }
        }
    }

    // MARK: - Recovery

    private var recoverySection: some View {
        Section(
            title: "Recovery",
            subtitle: "Audio recordings whose upload failed. Retry uploads to the cloud, or discard once you've verified a successful retry."
        ) {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                ForEach(orphanStore.orphans) { orphan in
                    orphanRow(orphan)
                    if orphan.id != orphanStore.orphans.last?.id {
                        Divider().overlay(DSColor.Border.subtle)
                    }
                }
            }
        }
    }

    private func orphanRow(_ orphan: OrphanedRecording) -> some View {
        let isRetrying = viewModel.orphanRetryInProgress == orphan.id
        return VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(spacing: DSSpacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(orphan.title?.isEmpty == false ? orphan.title! : "Untitled audio recording")
                        .font(DSFont.Body.lg())
                        .foregroundStyle(DSColor.Text.primary)
                    Text(orphanSubtitle(orphan))
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.secondary)
                }
                Spacer()
                if let rescuedSlug = orphan.rescuedSlug {
                    Pill("Rescued", kind: .success)
                    SecondaryButton("Open", icon: "arrow.up.right.square") {
                        if let url = URL(string: "https://loom.dissonance.cloud/notes/\(rescuedSlug)") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }
            }
            if let lastError = orphan.lastError, !lastError.isEmpty, orphan.rescuedSlug == nil {
                Text("Last error: \(lastError)")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .lineLimit(2)
            }
            HStack(spacing: DSSpacing.sm) {
                if orphan.rescuedSlug == nil {
                    PrimaryButton(
                        isRetrying ? "Uploading…" : "Retry upload",
                        icon: isRetrying ? "arrow.up.circle" : "arrow.up.circle.fill"
                    ) {
                        viewModel.retryOrphan(orphan)
                    }
                    .disabled(isRetrying)
                }
                SecondaryButton("Reveal in Finder", icon: "folder") {
                    NSWorkspace.shared.activateFileViewerSelecting([orphan.storageDirectory])
                }
                SecondaryButton("Discard", icon: "trash") {
                    viewModel.discardOrphan(orphan)
                }
                .disabled(isRetrying)
            }
        }
        .padding(.vertical, DSSpacing.xs)
    }

    private func orphanSubtitle(_ orphan: OrphanedRecording) -> String {
        let mins = Int(orphan.durationSeconds / 60)
        let secs = Int(orphan.durationSeconds.truncatingRemainder(dividingBy: 60))
        let date = orphan.capturedAt.formatted(date: .abbreviated, time: .shortened)
        let mb = Double(orphan.totalBytes()) / 1024 / 1024
        return String(format: "%d:%02d • %.1f MB • captured %@", mins, secs, mb, date)
    }

    // MARK: - Diagnostics

    private var diagnosticsSection: some View {
        Section(title: "Diagnostics", subtitle: nil) {
            DisclosureGroup(isExpanded: $diagnosticsExpanded) {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    versionHealthCard
                    HStack(spacing: DSSpacing.sm) {
                        SecondaryButton("Test video backend", icon: "checkmark.seal") {
                            viewModel.startAndAbortBackendHandshake()
                        }
                        SecondaryButton("Test audio backend", icon: "checkmark.seal") {
                            viewModel.startAndAbortAudioBackendHandshake()
                        }
                    }
                    if !viewModel.statusMessage.isEmpty {
                        Text(viewModel.statusMessage)
                            .font(DSFont.Mono.body())
                            .foregroundStyle(DSColor.Text.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(DSSpacing.md)
                            .background(DSColor.Bg.subtle, in: RoundedRectangle(cornerRadius: DSRadius.sm))
                    }
                }
                .padding(.top, DSSpacing.md)
            } label: {
                Text("Show developer tools")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
            }
        }
    }

    private var versionHealthCard: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: DSSpacing.sm) {
                Text("Version health")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                versionPill
                Spacer()
                SecondaryButton(isCheckingServerVersion ? "Checking..." : "Check", icon: "arrow.clockwise") {
                    Task { await checkServerVersion() }
                }
                .disabled(isCheckingServerVersion)
            }
            diagnosticRow(label: "Desktop", value: BuildStamp.commit)
            diagnosticRow(label: "Server", value: serverVersion?.commit ?? "Unknown")
            diagnosticRow(label: "API", value: BuildStamp.apiBaseURL)
            if let buildTime = serverVersion?.buildTime {
                diagnosticRow(label: "Server built", value: buildTime)
            }
            Text(serverVersionStatus)
                .font(DSFont.Body.sm())
                .foregroundStyle(versionStatusColor)
        }
        .padding(DSSpacing.md)
        .background(DSColor.Bg.subtle, in: RoundedRectangle(cornerRadius: DSRadius.md))
    }

    private var versionPill: some View {
        let (label, kind): (String, Pill.Kind) = {
            guard let serverVersion else { return ("Unchecked", .warning) }
            let serverCommit = BuildStamp.normalize(commit: serverVersion.commit)
            if serverCommit == "unknown" || serverCommit.isEmpty {
                return ("Unknown", .warning)
            }
            return serverCommit == BuildStamp.comparableCommit
                ? ("Matched", .success)
                : ("Mismatch", .warning)
        }()
        return Pill(label, kind: kind)
    }

    private var versionStatusColor: Color {
        guard let serverVersion else { return DSColor.Text.tertiary }
        let serverCommit = BuildStamp.normalize(commit: serverVersion.commit)
        if serverCommit == "unknown" || serverCommit.isEmpty {
            return DSColor.State.warning
        }
        return serverCommit == BuildStamp.comparableCommit
            ? DSColor.State.success
            : DSColor.State.warning
    }

    private func diagnosticRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: DSSpacing.sm) {
            Text(label)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .frame(width: 82, alignment: .leading)
            Text(value)
                .font(DSFont.Mono.body())
                .foregroundStyle(DSColor.Text.primary)
                .textSelection(.enabled)
            Spacer()
        }
    }

    @MainActor
    private func checkServerVersion() async {
        guard let backend = viewModel.backendClient else {
            serverVersionStatus = "Sign in to check the server version."
            return
        }
        isCheckingServerVersion = true
        defer { isCheckingServerVersion = false }
        do {
            let version = try await backend.serverVersion()
            serverVersion = version
            let serverCommit = BuildStamp.normalize(commit: version.commit)
            if serverCommit == "unknown" || serverCommit.isEmpty {
                serverVersionStatus = "Server did not publish a commit. Deployment may need build metadata."
            } else if serverCommit == BuildStamp.comparableCommit {
                serverVersionStatus = "Desktop and server are on the same build."
            } else {
                serverVersionStatus = "Desktop is \(BuildStamp.comparableCommit); server is \(serverCommit). Reinstall or wait for deploy if you just pushed."
            }
        } catch {
            serverVersionStatus = "Version check failed: \(error.localizedDescription)"
        }
    }
}

/// Section wrapper used by SettingsSheet — title + subtitle + body.
private struct Section<Content: View>: View {
    let title: String
    let subtitle: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                if let subtitle {
                    Text(subtitle)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.secondary)
                }
            }
            content
        }
    }
}
