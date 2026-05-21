import AppKit
import SwiftUI

struct OnboardingView: View {
    @ObservedObject private var viewModel: RecorderViewModel
    @ObservedObject private var progress: OnboardingProgressStore

    let topContentPadding: CGFloat
    let onPermissionsChanged: () -> Void
    let onFinish: () -> Void
    let onSkip: () -> Void

    @State private var step: OnboardingStep
    @State private var permissionStatus: PermissionStatus = PermissionChecker.currentStatus()
    @State private var requesting: PermissionChecker.WhichPermission?
    @State private var preferences = UserPreferencesDTO.defaults
    @State private var preferencesStatus: String?

    init(
        viewModel: RecorderViewModel,
        progress: OnboardingProgressStore,
        topContentPadding: CGFloat,
        onPermissionsChanged: @escaping () -> Void,
        onFinish: @escaping () -> Void,
        onSkip: @escaping () -> Void
    ) {
        self.viewModel = viewModel
        self.progress = progress
        self.topContentPadding = topContentPadding
        self.onPermissionsChanged = onPermissionsChanged
        self.onFinish = onFinish
        self.onSkip = onSkip
        self._step = State(initialValue: progress.currentStep)
    }

    var body: some View {
        VStack(spacing: 0) {
            phaseStepper
                .padding(.top, topContentPadding)
                .padding(.horizontal, DSSpacing.xxl)
                .padding(.bottom, DSSpacing.lg)

            Divider().overlay(DSColor.Border.subtle)

            HStack(spacing: 0) {
                copyPanel
                    .frame(width: 420)
                    .frame(maxHeight: .infinity)
                    .background(DSColor.Bg.canvas)

                Divider().overlay(DSColor.Border.subtle)

                visualPanel
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(DSColor.Bg.surface.opacity(0.36))
            }

            footer
                .padding(.horizontal, DSSpacing.xxl)
                .padding(.vertical, DSSpacing.lg)
                .background(DSColor.Bg.canvas)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DSColor.Bg.canvas)
        .task {
            await loadPreferences()
        }
        .onChange(of: step) { _, newStep in
            progress.recordStep(newStep)
            if newStep == .defaults {
                viewModel.refreshCaptureSources()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in
            refreshPermissions()
        }
    }

    private var phaseStepper: some View {
        HStack(spacing: DSSpacing.md) {
            ForEach(Array(OnboardingPhase.allCases.enumerated()), id: \.element.rawValue) { index, phase in
                Text(phase.rawValue)
                    .font(DSFont.Body.lg())
                    .foregroundStyle(phase == step.phase ? DSColor.Text.primary : DSColor.Text.tertiary)
                if index < OnboardingPhase.allCases.count - 1 {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DSColor.Text.tertiary)
                }
            }
            Spacer()
            Pill("\(step.rawValue + 1) of \(OnboardingStep.allCases.count)", kind: .muted)
        }
    }

    private var copyPanel: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xl) {
            Pill(stepEyebrow, kind: .muted)

            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                Text(stepHeadline)
                    .font(DSFont.Display.xl())
                    .foregroundStyle(DSColor.Text.primary)
                    .fixedSize(horizontal: false, vertical: true)

                Text(stepBody)
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.secondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if step == .welcome {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    valueRow(icon: "video.fill", title: "Screen videos", body: "Screen, camera, mic, upload, share.")
                    valueRow(icon: "waveform.circle.fill", title: "Meeting notes", body: "Audio capture, live notes, generated summaries.")
                    valueRow(icon: "lock.shield", title: "Yours by default", body: "Self-hosted workspace, local desktop capture.")
                }
            }

            Spacer()
        }
        .padding(.leading, DSSpacing.xxl)
        .padding(.trailing, DSSpacing.xl)
        .padding(.vertical, DSSpacing.xxl)
    }

    @ViewBuilder
    private var visualPanel: some View {
        switch step {
        case .welcome:
            welcomeVisual
        case .permissions:
            permissionsVisual
        case .defaults:
            defaultsVisual
        case .learnVideo:
            videoVisual
        case .learnNotes:
            notesVisual
        }
    }

    private var welcomeVisual: some View {
        VStack(spacing: DSSpacing.xl) {
            BrandLogoMark(size: 72)
            HStack(spacing: DSSpacing.lg) {
                productCard(
                    icon: "video.fill",
                    title: "Video",
                    body: "Record a walkthrough and share the link."
                )
                productCard(
                    icon: "waveform.circle.fill",
                    title: "Notes",
                    body: "Capture a call and turn it into structured notes."
                )
            }
            .frame(maxWidth: 560)
        }
        .padding(DSSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var permissionsVisual: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.xl) {
                Text("First things first: Loomola needs a few permissions.")
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: DSSpacing.md) {
                    permissionRow(
                        title: "Camera",
                        description: "Show and record your camera bubble.",
                        state: permissionStatus.camera,
                        which: .camera
                    )
                    permissionRow(
                        title: "Microphone",
                        description: "Capture your voice for videos and notes.",
                        state: permissionStatus.microphone,
                        which: .microphone
                    )
                    permissionRow(
                        title: "Screen Recording",
                        description: "Capture the screen you want to explain.",
                        state: permissionStatus.screenRecording,
                        which: .screenRecording
                    )
                    permissionRow(
                        title: "Accessibility",
                        description: "Optional. Helps global shortcuts on locked-down Macs.",
                        state: permissionStatus.accessibility,
                        which: .accessibility
                    )
                }

                if permissionStatus.screenRecording == .granted {
                    relaunchHint
                }
            }
            .padding(DSSpacing.xxl)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var defaultsVisual: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.xl) {
                Text("Choose your defaults")
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)

                HStack(alignment: .top, spacing: DSSpacing.lg) {
                    FieldPicker(
                        label: "Camera",
                        placeholder: "System default",
                        icon: "camera",
                        options: viewModel.captureSources.cameras.map {
                            .init(id: $0.id, title: $0.name)
                        },
                        selection: Binding(
                            get: { viewModel.selectedCameraDeviceID },
                            set: { viewModel.setSelectedCameraDevice(id: $0) }
                        )
                    )
                    FieldPicker(
                        label: "Microphone",
                        placeholder: "System default",
                        icon: "mic",
                        options: viewModel.captureSources.microphones.map {
                            .init(id: $0.id, title: $0.name)
                        },
                        selection: Binding(
                            get: { viewModel.selectedMicDeviceID },
                            set: { viewModel.setSelectedMicDevice(id: $0) }
                        )
                    )
                }

                HStack(alignment: .top, spacing: DSSpacing.lg) {
                    FieldPicker(
                        label: "Transcription language",
                        placeholder: "English",
                        icon: "waveform",
                        options: transcriptionLanguageOptions,
                        selection: Binding(
                            get: { preferences.transcriptionLanguage },
                            set: { value in
                                let next = value ?? "en"
                                preferences.transcriptionLanguage = next
                                savePreferences(UpdateUserPreferencesRequest(transcriptionLanguage: next))
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
                                let next = value ?? "same-as-transcript"
                                preferences.summaryLanguage = next
                                savePreferences(UpdateUserPreferencesRequest(summaryLanguage: next))
                            }
                        )
                    )
                }

                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    settingsToggleRow(
                        title: "Meeting detection",
                        subtitle: "Notice Meet, Zoom, Teams, and Webex context.",
                        isOn: Binding(
                            get: { preferences.meetingDetectionEnabled },
                            set: { enabled in
                                preferences.meetingDetectionEnabled = enabled
                                viewModel.setMeetingDetectionEnabled(enabled)
                                savePreferences(UpdateUserPreferencesRequest(meetingDetectionEnabled: enabled))
                            }
                        )
                    )
                    settingsToggleRow(
                        title: "Floating recording pill",
                        subtitle: "Keep a small status indicator visible while audio notes record.",
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
                }

                if let preferencesStatus {
                    Text(preferencesStatus)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                }
            }
            .padding(DSSpacing.xxl)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var videoVisual: some View {
        VStack(spacing: DSSpacing.xl) {
            mockWindow(title: "Product walkthrough") {
                VStack(spacing: DSSpacing.lg) {
                    ZStack(alignment: .bottomTrailing) {
                        RoundedRectangle(cornerRadius: DSRadius.md)
                            .fill(DSColor.Bg.subtle)
                            .overlay {
                                VStack(spacing: DSSpacing.sm) {
                                    Image(systemName: "rectangle.dashed")
                                        .font(.system(size: 44, weight: .light))
                                        .foregroundStyle(DSColor.Text.tertiary)
                                    Text("Your screen")
                                        .font(DSFont.Body.md())
                                        .foregroundStyle(DSColor.Text.secondary)
                                }
                            }
                            .frame(height: 240)
                        Circle()
                            .fill(DSColor.Accent.primary.opacity(0.22))
                            .overlay {
                                Image(systemName: "person.crop.circle.fill")
                                    .font(.system(size: 38))
                                    .foregroundStyle(DSColor.Accent.primary)
                            }
                            .frame(width: 92, height: 92)
                            .padding(DSSpacing.lg)
                    }
                    HStack {
                        Pill("REC 00:18", kind: .recording)
                        Spacer()
                        SecondaryButton("Stop", icon: "stop.fill") {}
                    }
                }
            }
            caption("Start a video, move your bubble where it belongs, stop from the floating HUD, then share the generated link.")
        }
        .padding(DSSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var notesVisual: some View {
        VStack(spacing: DSSpacing.xl) {
            mockWindow(title: "Feedback Session with Jane") {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    HStack {
                        Pill("Today", kind: .muted)
                        Pill("Me", kind: .muted)
                        Spacer()
                        Pill("Recording", kind: .recording)
                    }
                    noteBlock(
                        title: "Raw notes",
                        body: "Jane likes the first version. Follow up Friday with pricing and a cleaner demo clip."
                    )
                    noteBlock(
                        title: "Generated outline",
                        body: "Progress, objections, next steps, and owner-visible action items."
                    )
                    HStack {
                        Spacer()
                        Pill("Generate notes", kind: .success)
                    }
                }
            }
            caption("For meetings, Loomola opens a focused note workspace while audio records. Your typed notes and transcript feed the final summary.")
        }
        .padding(DSSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var footer: some View {
        HStack(spacing: DSSpacing.md) {
            SecondaryButton("Skip setup", icon: "forward.end") {
                onSkip()
            }
            Spacer()
            if step.previous != nil {
                SecondaryButton("Back", icon: "arrow.left") {
                    withAnimation(LoomolaMotion.medium) {
                        step = step.previous ?? .welcome
                    }
                }
            }
            PrimaryButton(primaryTitle, icon: primaryIcon) {
                continueFromCurrentStep()
            }
        }
    }

    private func continueFromCurrentStep() {
        if let next = step.next {
            withAnimation(LoomolaMotion.medium) {
                step = next
            }
        } else {
            onFinish()
        }
    }

    private func refreshPermissions() {
        permissionStatus = PermissionChecker.currentStatus()
        onPermissionsChanged()
    }

    @MainActor
    private func request(_ which: PermissionChecker.WhichPermission) async {
        requesting = which
        defer { requesting = nil }
        switch which {
        case .camera:
            _ = await PermissionChecker.requestCamera()
        case .microphone:
            _ = await PermissionChecker.requestMicrophone()
        case .screenRecording:
            PermissionChecker.requestScreenRecording()
            PermissionChecker.markScreenRecordingAsked()
        case .accessibility:
            PermissionChecker.openSystemSettings(for: .accessibility)
        }
        refreshPermissions()
    }

    private func loadPreferences() async {
        guard let backend = viewModel.backendClient else { return }
        do {
            let response = try await backend.getUserPreferences()
            await MainActor.run {
                preferences = response.preferences
                viewModel.applySyncedUserPreferences(response.preferences)
            }
        } catch {
            await MainActor.run {
                preferencesStatus = "Preferences unavailable. You can continue and adjust them later."
            }
        }
    }

    private func savePreferences(_ request: UpdateUserPreferencesRequest) {
        guard let backend = viewModel.backendClient else {
            preferencesStatus = "Sign in sync is still warming up. Saved locally where possible."
            return
        }
        preferencesStatus = "Saving..."
        Task {
            do {
                let response = try await backend.updateUserPreferences(request)
                await MainActor.run {
                    preferences = response.preferences
                    viewModel.applySyncedUserPreferences(response.preferences)
                    preferencesStatus = "Saved."
                }
            } catch {
                await MainActor.run {
                    preferencesStatus = "Save failed. You can adjust this later in Settings."
                }
            }
        }
    }

    private func permissionRow(
        title: String,
        description: String,
        state: PermissionStatus.State,
        which: PermissionChecker.WhichPermission
    ) -> some View {
        HStack(alignment: .center, spacing: DSSpacing.lg) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text(description)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: DSSpacing.lg)
            permissionAction(state: state, which: which)
        }
        .padding(.vertical, DSSpacing.md)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(DSColor.Border.subtle)
                .frame(height: 1)
        }
    }

    @ViewBuilder
    private func permissionAction(
        state: PermissionStatus.State,
        which: PermissionChecker.WhichPermission
    ) -> some View {
        switch state {
        case .granted:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(DSColor.State.success)
                .frame(width: 138, alignment: .center)
        case .notDetermined:
            PrimaryButton(requesting == which ? "Requesting..." : "Allow") {
                Task { await request(which) }
            }
            .disabled(requesting != nil)
            .frame(width: 138, alignment: .trailing)
        case .denied:
            SecondaryButton("Open Settings", icon: "gear") {
                PermissionChecker.openSystemSettings(for: which)
            }
            .frame(width: 168, alignment: .trailing)
        }
    }

    private var relaunchHint: some View {
        HStack(alignment: .center, spacing: DSSpacing.md) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(DSColor.State.warning)
            VStack(alignment: .leading, spacing: 2) {
                Text("Screen Recording may need a relaunch")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text("macOS sometimes re-checks this permission only when the app starts.")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
            }
            Spacer()
            PrimaryButton("Relaunch", icon: "arrow.clockwise") {
                AppRelauncher.relaunch()
            }
        }
        .padding(DSSpacing.lg)
        .background(DSColor.State.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: DSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md)
                .strokeBorder(DSColor.State.warning.opacity(0.35), lineWidth: 1)
        )
    }

    private func settingsToggleRow(
        title: String,
        subtitle: String,
        isOn: Binding<Bool>
    ) -> some View {
        HStack(alignment: .center, spacing: DSSpacing.lg) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text(subtitle)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Toggle("", isOn: isOn)
                .labelsHidden()
                .toggleStyle(.switch)
        }
        .padding(DSSpacing.lg)
        .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        )
    }

    private func valueRow(icon: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: DSSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(DSColor.Accent.primary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                Text(body)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func productCard(icon: String, title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(DSColor.Accent.primary)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text(body)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(DSSpacing.xl)
        .frame(maxWidth: .infinity, minHeight: 190, alignment: .topLeading)
        .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        )
        .dsShadow(.subtle)
    }

    private func mockWindow<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 7) {
                Circle().fill(Color.red.opacity(0.8)).frame(width: 9, height: 9)
                Circle().fill(Color.yellow.opacity(0.8)).frame(width: 9, height: 9)
                Circle().fill(Color.green.opacity(0.8)).frame(width: 9, height: 9)
                Text(title)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.secondary)
                    .padding(.leading, DSSpacing.md)
                Spacer()
            }
            .padding(DSSpacing.md)
            Divider().overlay(DSColor.Border.subtle)
            content()
                .padding(DSSpacing.lg)
        }
        .frame(maxWidth: 620)
        .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        )
        .dsShadow(.raised)
    }

    private func noteBlock(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text(title)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
            Text(body)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DSColor.Bg.subtle, in: RoundedRectangle(cornerRadius: DSRadius.sm))
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(DSFont.Body.md())
            .foregroundStyle(DSColor.Text.secondary)
            .multilineTextAlignment(.center)
            .lineSpacing(3)
            .frame(maxWidth: 560)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var stepEyebrow: String {
        switch step {
        case .welcome: return "Two products"
        case .permissions: return "Mac setup"
        case .defaults: return "Defaults"
        case .learnVideo: return "Screen videos"
        case .learnNotes: return "Meeting notes"
        }
    }

    private var stepHeadline: String {
        switch step {
        case .welcome:
            return "Welcome to Loomola."
        case .permissions:
            return "Grant only what recording needs."
        case .defaults:
            return "Set the capture defaults you will use every day."
        case .learnVideo:
            return "A screen video is a quick walkthrough."
        case .learnNotes:
            return "A meeting note is capture plus live context."
        }
    }

    private var stepBody: String {
        switch step {
        case .welcome:
            return "Loomola records screen videos and AI meeting notes into the same self-hosted workspace. You get shareable video links and structured meeting review without splitting your library."
        case .permissions:
            return "macOS asks for recording access one piece at a time. You can skip setup, but video and audio capture will stay blocked until the required permissions are granted."
        case .defaults:
            return "Pick the camera, microphone, and language behavior that should be ready when you open the app. Everything here is still editable later in Settings."
        case .learnVideo:
            return "Use this when you want to explain something visually: a bug, a walkthrough, a decision, a handoff, or a client update."
        case .learnNotes:
            return "Use this when you want to stay present in the meeting. Loomola captures the audio, keeps your typed notes with the transcript, and generates the review artifact afterward."
        }
    }

    private var primaryTitle: String {
        step.next == nil ? "Finish setup" : "Continue"
    }

    private var primaryIcon: String {
        step.next == nil ? "checkmark" : "arrow.right"
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
}
