import AppKit
import Combine
import CoreGraphics
import Foundation
import OSLog
import Supabase

private let recorderLog = Logger(subsystem: "cloud.dissonance.loom.desktop", category: "recorder")

@MainActor
final class RecorderViewModel: ObservableObject {
    @Published private(set) var state: RecorderState = .signedOut
    @Published var email = ""
    @Published var password = ""
    @Published var audioTitle = ""
    @Published private(set) var audioTitleManuallyEdited = false
    @Published var includeMicInAudioNote = true
    @Published var includeSystemAudioInAudioNote =
        RecorderViewModel.defaultIncludeSystemAudioInAudioNote()
    @Published private(set) var statusMessage = "Sign in to capture with Loomola."
    @Published private(set) var configuration: DesktopAuthConfiguration?
    @Published private(set) var activeRecordingKind: DesktopRecordingKind?
    @Published private(set) var activeAudioRecordingStartedAt: Date?
    @Published private(set) var activeAudioRecordingSlug: String?
    /// Backend media_object UUID for the active audio recording.
    /// Used by the live-notes side panel to PUT the typed body to
    /// /api/notes/<id> via debounced autosave. Cleared when the
    /// recording stops.
    @Published private(set) var activeAudioRecordingId: String?
    /// True while the audio note recording is paused. Drives the
    /// Pause↔Resume UI state in RecordingHomeView. Mirrors
    /// AudioNoteRecorder.paused but kept as an @Published mirror
    /// so SwiftUI re-renders on transition.
    @Published private(set) var isAudioNotePaused: Bool = false
    /// Wall-clock time of the most recent pause for the active audio
    /// note recording. Used to freeze the elapsed-timer display while
    /// paused. Nil when running.
    @Published private(set) var audioNotePausedAt: Date?
    /// Total time (seconds) the active recording has spent paused.
    /// The timer in RecordingHomeView shows
    /// (now - startedAt) - audioNotePausedAccumulatedSeconds so
    /// it matches the actual recorded audio duration.
    @Published private(set) var audioNotePausedAccumulatedSeconds: TimeInterval = 0
    /// Live-typed manual notes body for the active audio recording.
    /// Bound to the NotesSidePanel textarea, debounced-saved to
    /// /api/notes/<mediaId> while recording.
    @Published var liveNotesBody: String = ""
    @Published private(set) var activeVideoRecordingStartedAt: Date?
    /// True while the composite recorder is being set up off the
    /// main actor. The Start button binds to !isStartingRecording so
    /// double-clicks during cold-start can't re-enter and the UI
    /// reads as "starting…" instead of dead.
    @Published private(set) var isStartingRecording: Bool = false
    @Published private(set) var audioLevel = 0.0
    @Published private(set) var meetingContext: MeetingContext?
    @Published private(set) var meetingPromptContext: MeetingContext?
    @Published private(set) var meetingDetectionEnabled: Bool =
        UserDefaults.standard.object(forKey: "loomola.meetingDetectionEnabled") as? Bool ?? true
    @Published private(set) var floatingRecordingIndicatorEnabled: Bool =
        UserDefaults.standard.object(forKey: "loomola.floatingRecordingIndicatorEnabled") as? Bool ?? true
    @Published private(set) var liveTranscriptionEnabled: Bool =
        UserDefaults.standard.object(forKey: "loomola.liveTranscriptionEnabled") as? Bool ?? true
    @Published private(set) var nativeMessagingStatus = "Chrome bridge can be installed after the extension is loaded."
    @Published private(set) var isInstallingNativeMessagingHost = false
    @Published private(set) var captureSources = CaptureSourceSnapshot(
        displays: [],
        windows: [],
        cameras: [],
        microphones: []
    )
    /// User's chosen camera + mic device ids. nil means "system default."
    /// Persisted to UserDefaults so the choice carries across launches.
    @Published var selectedCameraDeviceID: String? = UserDefaults.standard
        .string(forKey: "loomola.selectedCameraDeviceID")
    @Published var selectedMicDeviceID: String? = UserDefaults.standard
        .string(forKey: "loomola.selectedMicDeviceID")
    @Published var systemAudioCaptureMode: SystemAudioCaptureMode =
        RecorderViewModel.initialSystemAudioCaptureMode()
    @Published var selectedSystemAudioDeviceID: String? = UserDefaults.standard
        .string(forKey: "loomola.selectedSystemAudioDeviceID")

    /// Lazily-built service powering the Recent strip on the idle
    /// home view. Created on first access once the backend client
    /// exists; nil on signed-out state. Read by MainRecorderView via
    /// `recentRecordings` accessor.
    private var _recentService: RecentRecordingsService?

    var recentRecordings: RecentRecordingsService {
        if let existing = _recentService { return existing }
        // If the backend isn't ready yet, vend a dummy service that
        // never fetches (it'll be replaced when the user signs in).
        let usingRealBackend = backendClient != nil
        let backend = backendClient ?? BackendClient(
            baseURL: configuration?.apiBaseURL ?? URL(string: "https://loom.dissonance.cloud")!
        ) { throw RecorderViewModelError.missingAccessToken }
        let service = RecentRecordingsService(backend: backend)
        recorderLog.notice("recentRecordings — created service (real backend: \(usingRealBackend, privacy: .public))")
        _recentService = service
        return service
    }

    private var authService: DesktopAuthService?
    private var accessToken: String?
    private(set) var backendClient: BackendClient?
    private var audioNoteRecorder: AudioNoteRecorder?
    let liveTranscription = LiveTranscriptionCoordinator()
    private var obsidianExportWriter: ObsidianExportWriter?
    private var obsidianRealtimeSubscriber: ObsidianRealtimeSubscriber?
    private var obsidianSyncTask: Task<Void, Never>?
    private var obsidianRealtimeTask: Task<Void, Never>?
    private var meetingWatchTask: Task<Void, Never>?
    private var obsidianSyncInFlight = false
    private var dismissedMeetingContext: MeetingContext?
    private var autoSuggestedAudioTitle: String?
    private var audioTitleAutosaveTask: Task<Void, Never>?
    private var liveTranscriptionCancellable: AnyCancellable?
    @Published private(set) var lastStoppedAudioRecordingForReview: RecentRecording?
    private var lastSyncedAudioTitle: String = ""
    private var lastAudioLevelUpdate = Date.distantPast
    private let captureSourceProvider: CaptureSourceProvider?
    private let screenCaptureCoordinator: ScreenCaptureCoordinator?
    private let nativeMessagingInstaller = NativeMessagingHostInstaller()
    private var activeRecordingURL: URL?
    /// Composite recorder for the M2 video flow. Holds AVAssetWriter +
    /// CIContext + sample-buffer plumbing for screen + bubble + mic.
    /// nil when no composite recording is active.
    private var compositeRecorder: Any? // CompositeRecorder gated on macOS 14
    /// Mic coordinator dedicated to the active composite recording.
    /// Separate from audioNoteRecorder so video + audio note flows don't
    /// share state. Stops on stopLocalRecordingAndUpload.
    private var compositeMicCoordinator: MicrophoneCaptureCoordinator?
    private var compositeStartWatchdogTask: Task<Void, Never>?
    private var pendingCompositeMicTask: Task<Void, Never>?
    private var pendingCompositeStartToken: UUID?
    private var activeCompositeRecordingToken: UUID?

    private static let allowAppleSystemAudioCaptureKey = "loomola.allowAppleSystemAudioCapture"

    static var allowsAppleSystemAudioCapture: Bool {
        UserDefaults.standard.bool(forKey: allowAppleSystemAudioCaptureKey)
    }

    static var systemAudioCaptureModesForSettings: [SystemAudioCaptureMode] {
        var modes: [SystemAudioCaptureMode] = []
        if #available(macOS 14.2, *) {
            modes.append(.coreAudioTap)
        }
        modes.append(.audioDevice)
        if allowsAppleSystemAudioCapture {
            modes.append(.screenCaptureKit)
        }
        return modes
    }

    private static func defaultIncludeSystemAudioInAudioNote() -> Bool {
        if #available(macOS 14.2, *) {
            return true
        }
        return false
    }

    private static func initialSystemAudioCaptureMode() -> SystemAudioCaptureMode {
        let defaultMode: SystemAudioCaptureMode
        if #available(macOS 14.2, *) {
            defaultMode = .coreAudioTap
        } else {
            defaultMode = .audioDevice
        }
        let stored = SystemAudioCaptureMode(
            rawValue: UserDefaults.standard.string(forKey: "loomola.systemAudioCaptureMode") ?? ""
        ) ?? defaultMode
        if stored == .coreAudioTap {
            if #available(macOS 14.2, *) {
                return .coreAudioTap
            }
            UserDefaults.standard.set(
                SystemAudioCaptureMode.audioDevice.rawValue,
                forKey: "loomola.systemAudioCaptureMode"
            )
            return .audioDevice
        }
        if stored == .screenCaptureKit && !allowsAppleSystemAudioCapture {
            UserDefaults.standard.set(
                defaultMode.rawValue,
                forKey: "loomola.systemAudioCaptureMode"
            )
            return defaultMode
        }
        return stored
    }

    /// Persist + apply the user's chosen camera device ID. Restarting
    /// the shared camera coordinator with the new ID swaps the input
    /// without tearing the session down.
    func setSelectedCameraDevice(id: String?) {
        selectedCameraDeviceID = id
        if let id {
            UserDefaults.standard.set(id, forKey: "loomola.selectedCameraDeviceID")
        } else {
            UserDefaults.standard.removeObject(forKey: "loomola.selectedCameraDeviceID")
        }
        // If the camera is currently running (bubble visible or
        // composite recording in progress), swap the input now.
        CameraCaptureCoordinator.shared.requestPermissionAndStart(deviceID: id)
    }

    /// Persist the chosen mic ID. The active composite recording (if
    /// any) keeps its current mic — the swap takes effect on the next
    /// startLocalRecording call. We could swap mid-recording too but
    /// it's surprising UX, so defer.
    func setSelectedMicDevice(id: String?) {
        selectedMicDeviceID = id
        if let id {
            UserDefaults.standard.set(id, forKey: "loomola.selectedMicDeviceID")
        } else {
            UserDefaults.standard.removeObject(forKey: "loomola.selectedMicDeviceID")
        }
    }

    func setSystemAudioCaptureMode(_ mode: SystemAudioCaptureMode) {
        guard mode != .screenCaptureKit || Self.allowsAppleSystemAudioCapture else {
            systemAudioCaptureMode = .coreAudioTap
            UserDefaults.standard.set(
                SystemAudioCaptureMode.coreAudioTap.rawValue,
                forKey: "loomola.systemAudioCaptureMode"
            )
            return
        }
        systemAudioCaptureMode = mode
        UserDefaults.standard.set(mode.rawValue, forKey: "loomola.systemAudioCaptureMode")
    }

    func setSelectedSystemAudioDevice(id: String?) {
        selectedSystemAudioDeviceID = id
        if let id {
            UserDefaults.standard.set(id, forKey: "loomola.selectedSystemAudioDeviceID")
        } else {
            UserDefaults.standard.removeObject(forKey: "loomola.selectedSystemAudioDeviceID")
        }
    }

    var needsSystemAudioDeviceSelection: Bool {
        includeSystemAudioInAudioNote &&
            systemAudioCaptureMode == .audioDevice &&
            selectedSystemAudioDeviceID == nil
    }
    private let obsidianSyncIntervalNanoseconds: UInt64 = 30_000_000_000
    private let meetingWatchIntervalNanoseconds: UInt64 = 15_000_000_000

    init() {
        if #available(macOS 14.0, *) {
            captureSourceProvider = CaptureSourceProvider()
            screenCaptureCoordinator = ScreenCaptureCoordinator()
        } else {
            captureSourceProvider = nil
            screenCaptureCoordinator = nil
        }

        do {
            let config = try DesktopAuthConfiguration.fromEnvironment()
            configuration = config
            let service = DesktopAuthService(configuration: config)
            authService = service
            backendClient = BackendClient(baseURL: config.apiBaseURL) { [weak self] in
                guard let token = await self?.currentAccessToken() else {
                    throw RecorderViewModelError.missingAccessToken
                }
                return token
            }
            audioNoteRecorder = backendClient.map {
                let recorder = AudioNoteRecorder(backend: $0)
                recorder.onAudioLevel = { [weak self] level in
                    Task { @MainActor in
                        self?.recordAudioLevel(level)
                    }
                }
                recorder.onLiveAudioBuffer = { [weak self] source, buffer in
                    guard let copy = buffer.loomolaCopyForAsyncUse() else { return }
                    Task { @MainActor in
                        self?.liveTranscription.append(buffer: copy, source: source)
                    }
                }
                return recorder
            }
            liveTranscriptionCancellable = liveTranscription.objectWillChange.sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            obsidianExportWriter = backendClient.map { ObsidianExportWriter(backend: $0) }
            obsidianRealtimeSubscriber = ObsidianRealtimeSubscriber(configuration: config) { [weak self] in
                guard let token = await self?.currentAccessToken() else {
                    throw RecorderViewModelError.missingAccessToken
                }
                return token
            }
            statusMessage = "Ready to sign in. Saved sessions are not auto-restored in this dev build."
        } catch {
            state = .failed(message: error.localizedDescription)
            statusMessage = error.localizedDescription
        }
    }

    func restoreSession() async {
        guard let authService else {
            recorderLog.notice("restoreSession — no authService configured (env missing?)")
            return
        }
        recorderLog.notice("restoreSession — attempting restore (10s timeout)")
        do {
            // Wrap in a continuation-based race so a hung
            // Supabase `client.auth.setSession(...)` (which we've
            // empirically seen never return on this user's setup)
            // doesn't pin the user on the signed-out screen with
            // a hidden task spinning forever. A regular task-group
            // timeout doesn't help because cancelling the network
            // task waits for it to exit, which it won't. Detached
            // tasks + a one-shot resolver = no waiting for the
            // hung task to acknowledge cancellation; it leaks
            // until the process exits, which is fine.
            let session: Session? = try await withCheckedThrowingContinuation { continuation in
                let resolver = RestoreResolver(continuation)
                Task {
                    do {
                        let result = try await authService.restoreSession()
                        resolver.resolve(.success(result))
                    } catch {
                        resolver.resolve(.failure(error))
                    }
                }
                Task {
                    try? await Task.sleep(nanoseconds: 10_000_000_000)
                    resolver.resolve(.failure(RestoreSessionError.timedOut))
                }
            }
            if let session {
                apply(session: session)
                statusMessage = "Signed in from saved session."
                recorderLog.notice("restoreSession — succeeded, applied session")
            } else {
                recorderLog.notice("restoreSession — returned nil (no saved session)")
            }
        } catch RestoreSessionError.timedOut {
            statusMessage = "Couldn't restore session within 10s. Sign in again."
            recorderLog.error("restoreSession — timed out after 10s (Supabase setSession hung)")
        } catch {
            statusMessage = "Saved session could not be restored. Sign in again."
            recorderLog.error("restoreSession — failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func signIn() {
        guard let authService else { return }
        state = .preparingPermissions
        statusMessage = "Signing in..."
        let email = email
        let password = password
        Task {
            do {
                let session = try await authService.signIn(email: email, password: password)
                apply(session: session)
                statusMessage = "Signed in. Backend upload client is ready."
            } catch {
                state = .signedOut
                statusMessage = "Sign-in failed: \(error.localizedDescription)"
            }
        }
    }

    func signOut() {
        guard let authService else { return }
        Task {
            compositeStartWatchdogTask?.cancel()
            pendingCompositeMicTask?.cancel()
            compositeStartWatchdogTask = nil
            pendingCompositeMicTask = nil
            pendingCompositeStartToken = nil
            activeCompositeRecordingToken = nil
            isStartingRecording = false
            if let screenCaptureCoordinator {
                try? await screenCaptureCoordinator.stop()
                screenCaptureCoordinator.onScreenSampleBuffer = nil
            }
            _ = try? await compositeMicCoordinator?.stop()
            compositeRecorder = nil
            compositeMicCoordinator = nil
            activeRecordingURL = nil
            activeVideoRecordingStartedAt = nil
            await audioNoteRecorder?.cancel()
            obsidianSyncTask?.cancel()
            obsidianRealtimeTask?.cancel()
            meetingWatchTask?.cancel()
            audioTitleAutosaveTask?.cancel()
            await obsidianRealtimeSubscriber?.stop()
            obsidianSyncTask = nil
            obsidianRealtimeTask = nil
            meetingWatchTask = nil
            audioTitleAutosaveTask = nil
            lastSyncedAudioTitle = ""
            audioTitleManuallyEdited = false
            lastStoppedAudioRecordingForReview = nil
            obsidianSyncInFlight = false
            meetingContext = nil
            meetingPromptContext = nil
            dismissedMeetingContext = nil
            autoSuggestedAudioTitle = nil
            activeAudioRecordingSlug = nil
            activeAudioRecordingId = nil
            audioLevel = 0
            liveTranscription.reset()
            try? await authService.signOut()
            accessToken = nil
            activeRecordingKind = nil
            activeAudioRecordingStartedAt = nil
            state = .signedOut
            statusMessage = "Signed out."
        }
    }

    func installNativeMessagingHost() {
        guard !isInstallingNativeMessagingHost else { return }
        isInstallingNativeMessagingHost = true
        nativeMessagingStatus = "Installing Chrome bridge..."
        Task {
            do {
                let result = try await nativeMessagingInstaller.install()
                let lastLine = result.output
                    .split(separator: "\n")
                    .last
                    .map(String.init)
                isInstallingNativeMessagingHost = false
                nativeMessagingStatus = lastLine.map {
                    "Chrome bridge installed. \($0)"
                } ?? "Chrome bridge installed. Reload the extension if Chrome was already open."
                statusMessage = nativeMessagingStatus
            } catch {
                isInstallingNativeMessagingHost = false
                nativeMessagingStatus = "Chrome bridge install failed."
                statusMessage = error.localizedDescription
            }
        }
    }

    func openExtensionFolder() {
        guard let url = NativeMessagingHostInstaller.extensionDirectoryURL() else {
            statusMessage = "Could not find the extension folder in this repo checkout."
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    func setMeetingDetectionEnabled(_ enabled: Bool) {
        guard meetingDetectionEnabled != enabled else { return }
        meetingDetectionEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: "loomola.meetingDetectionEnabled")
        if enabled {
            statusMessage = "Meeting detection enabled."
            if accessToken != nil {
                startMeetingWatch()
            }
        } else {
            meetingWatchTask?.cancel()
            meetingWatchTask = nil
            applyMeetingContext(nil)
            statusMessage = "Meeting detection disabled."
        }
    }

    func setFloatingRecordingIndicatorEnabled(_ enabled: Bool) {
        guard floatingRecordingIndicatorEnabled != enabled else { return }
        floatingRecordingIndicatorEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: "loomola.floatingRecordingIndicatorEnabled")
        statusMessage = enabled
            ? "Floating recording indicator enabled."
            : "Floating recording indicator disabled."
    }

    func applySyncedUserPreferences(_ preferences: UserPreferencesDTO) {
        meetingDetectionEnabled = preferences.meetingDetectionEnabled
        UserDefaults.standard.set(
            preferences.meetingDetectionEnabled,
            forKey: "loomola.meetingDetectionEnabled"
        )
        if preferences.meetingDetectionEnabled {
            if accessToken != nil {
                startMeetingWatch()
            }
        } else {
            meetingWatchTask?.cancel()
            meetingWatchTask = nil
            applyMeetingContext(nil)
        }

        floatingRecordingIndicatorEnabled = preferences.floatingRecordingIndicatorEnabled
        UserDefaults.standard.set(
            preferences.floatingRecordingIndicatorEnabled,
            forKey: "loomola.floatingRecordingIndicatorEnabled"
        )
    }

    func refreshUserPreferencesFromBackend(showStatus: Bool = false) {
        guard let backendClient else { return }
        Task { [weak self] in
            do {
                let response = try await backendClient.getUserPreferences()
                await MainActor.run {
                    self?.applySyncedUserPreferences(response.preferences)
                    if showStatus {
                        self?.statusMessage = "Preferences synced."
                    }
                }
            } catch {
                await MainActor.run {
                    if showStatus {
                        self?.statusMessage = "Preferences sync failed: \(error.localizedDescription)"
                    }
                }
            }
        }
    }

    func setLiveTranscriptionEnabled(_ enabled: Bool) {
        guard liveTranscriptionEnabled != enabled else { return }
        liveTranscriptionEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: "loomola.liveTranscriptionEnabled")
        if enabled, activeRecordingKind == .audio, let backendClient {
            liveTranscription.start(
                backend: backendClient,
                includeMic: includeMicInAudioNote,
                includeSystemAudio: includeSystemAudioInAudioNote,
                enabled: true
            )
        } else if !enabled {
            liveTranscription.stop()
        }
        statusMessage = enabled
            ? "Live transcription enabled."
            : "Live transcription disabled."
    }

    func startRecordingPlaceholder() {
        state = .recording
    }

    func stopRecordingPlaceholder() {
        state = .finalizing
    }

    func startAndAbortBackendHandshake() {
        guard let backendClient else { return }
        state = .uploading(progress: 0)
        statusMessage = "Creating a desktop-shaped recording row..."
        Task {
            do {
                let response = try await backendClient.startRecording(
                    StartRecordingRequest(
                        tracks: [
                            .init(kind: .composite, mimeType: "video/mp4"),
                            .init(kind: .mic, mimeType: "audio/mp4")
                        ],
                        resolution: "screen-native",
                        brandProfileId: nil
                    )
                )
                try await backendClient.abort(recordingId: response.recordingId)
                state = .signedInIdle
                statusMessage = "Backend handshake passed and test row was aborted. Slug: \(response.slug)"
            } catch {
                state = .failed(message: error.localizedDescription)
                statusMessage = "Backend handshake failed: \(error.localizedDescription)"
            }
        }
    }

    func startAndAbortAudioBackendHandshake() {
        guard let backendClient else { return }
        state = .uploading(progress: 0)
        statusMessage = "Creating an audio recording row..."
        Task {
            do {
                let response = try await backendClient.startRecording(
                    StartRecordingRequest(
                        type: .audio,
                        tracks: [
                            .init(kind: .mic, mimeType: "audio/mp4"),
                            .init(kind: .systemAudio, mimeType: "audio/mp4")
                        ],
                        resolution: "audio-only",
                        brandProfileId: nil,
                        title: "Desktop audio test",
                        meetingStartedAtLocal: ISO8601DateFormatter().string(from: Date()),
                        attendees: [],
                        sourceContextHint: "manual desktop audio backend handshake"
                    )
                )
                try await backendClient.abort(recordingId: response.recordingId)
                state = .signedInIdle
                statusMessage = "Audio backend handshake passed and test row was aborted. Slug: \(response.slug)"
            } catch {
                state = .failed(message: error.localizedDescription)
                statusMessage = "Audio backend handshake failed: \(error.localizedDescription)"
            }
        }
    }

    func refreshCaptureSources() {
        refreshCaptureSources(showStatus: true)
    }

    func checkMeetingContext() {
        dismissedMeetingContext = nil
        if !refreshChromeMeetingContext(showStatus: true) {
            refreshCaptureSources(showStatus: true)
        }
    }

    private func refreshCaptureSources(showStatus: Bool) {
        let hasChromeContext = refreshChromeMeetingContext(showStatus: false)
        guard let captureSourceProvider else {
            if showStatus && !hasChromeContext {
                statusMessage = "ScreenCaptureKit source listing requires macOS 14 or newer."
            }
            return
        }
        if showStatus {
            statusMessage = "Refreshing capture sources..."
        }
        Task {
            do {
                let snapshot = try await captureSourceProvider.snapshot()
                let context = ChromeMeetingSignalStore.readLatest() ?? MeetingDetector.detect(from: snapshot)
                let previousContext = meetingContext
                captureSources = snapshot
                applyMeetingContext(context)
                let detected = context.map { " Detected \($0.detectedApp)." } ?? ""
                if showStatus || (context != nil && context != previousContext) {
                    statusMessage = "Found \(snapshot.displays.count) display(s), \(snapshot.windows.count) window(s), \(snapshot.cameras.count) camera(s), and \(snapshot.microphones.count) mic(s).\(detected)"
                }
            } catch {
                if showStatus && !hasChromeContext {
                    statusMessage = "Could not list capture sources: \(error.localizedDescription)"
                }
            }
        }
    }

    /// Returns the view model to idle after a successful upload. The
    /// FinalizingHomeView keeps the success checkmark visible for ~1.5s
    /// after state flips to .complete, then calls this so the router
    /// swaps back to IdleHomeView and the new recording shows up in
    /// the Recent strip.
    func acknowledgeUploadComplete() {
        guard case .complete = state else { return }
        state = .signedInIdle
        statusMessage = "Ready to record."
    }

    func dismissMeetingPrompt() {
        dismissedMeetingContext = meetingPromptContext
        meetingPromptContext = nil
        statusMessage = "Meeting prompt dismissed. Manual audio notes still use detected context while the meeting remains visible."
    }

    func startDetectedMeetingAudioNote() {
        if let suggested = meetingPromptContext?.suggestedTitle ?? meetingContext?.suggestedTitle {
            autoSuggestedAudioTitle = suggested
        }
        meetingPromptContext = nil
        startAudioNoteRecording()
    }

    /// Open the detected meeting — direct URL when we have one (Meet
    /// or any Chrome-extension-supplied source), or activate the host
    /// app's bundle as a fallback (Zoom, Teams, Webex desktop clients).
    /// Doesn't dismiss the prompt — the user might want to also start
    /// a note after joining.
    func joinDetectedMeeting() {
        let context = meetingPromptContext ?? meetingContext
        guard let context else { return }
        if let url = context.joinURL {
            NSWorkspace.shared.open(url)
            return
        }
        if let bundleID = context.bundleIdentifier,
           let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first {
            app.activate(options: [.activateAllWindows])
            return
        }
        // Last-ditch: try opening the bundle ID as a URL via NSWorkspace
        // (e.g., x-zoom-call://). Most call apps register a scheme.
        statusMessage = "Couldn't bring the meeting forward — open it manually from your dock."
    }

    func startScreenPreview() {
        guard let screenCaptureCoordinator else {
            statusMessage = "ScreenCaptureKit requires macOS 14 or newer."
            return
        }
        state = .recording
        statusMessage = "Starting first-display screen stream..."
        Task {
            do {
                let display = try await screenCaptureCoordinator.startFirstDisplayCapture()
                statusMessage = "Capturing \(display.name) at \(display.width)x\(display.height)."
            } catch {
                state = .failed(message: error.localizedDescription)
                statusMessage = "Screen stream failed: \(error.localizedDescription)"
            }
        }
    }

    func stopScreenPreview() {
        guard let screenCaptureCoordinator else { return }
        Task {
            do {
                try await screenCaptureCoordinator.stop()
                state = .signedInIdle
                statusMessage = "Stopped screen stream after \(screenCaptureCoordinator.frameCount) frame(s)."
            } catch {
                state = .failed(message: error.localizedDescription)
                statusMessage = "Could not stop screen stream: \(error.localizedDescription)"
            }
        }
    }

    func startLocalRecording() {
        guard #available(macOS 14.0, *) else {
            statusMessage = "ScreenCaptureKit requires macOS 14 or newer."
            return
        }
        guard screenCaptureCoordinator != nil else {
            statusMessage = "ScreenCaptureKit requires macOS 14 or newer."
            return
        }
        guard let screen = NSScreen.main else {
            statusMessage = "No active display found."
            return
        }
        guard activeRecordingKind == nil, !isStartingRecording else {
            // Defensive: ignore double-clicks or re-entry while already
            // setting up.
            return
        }

        // Composite output dimensions = screen dimensions in pixels.
        let scale = screen.backingScaleFactor
        let pixelSize = CGSize(
            width: screen.frame.width * scale,
            height: screen.frame.height * scale
        )
        let displayBounds = DisplayPixelBounds(
            appKitOriginPoints: screen.frame.origin,
            sizePoints: screen.frame.size,
            backingScaleFactor: scale
        )

        let outputURL = FileManager.default.temporaryDirectory
            .appending(path: "loom-composite-\(UUID().uuidString).mp4")
        // The composite recorder muxes mic audio into the MP4
        // inline, so we don't need a separate per-mic .m4a file
        // here. Passing nil to MicrophoneCaptureCoordinator.start
        // skips its AudioAssetWriter construction — sidesteps the
        // AVAssetWriterInput crash on macOS 26.4.1, and saves an
        // unnecessary file write.

        // Optimistic UI state BEFORE the heavyweight setup. Lets
        // SwiftUI repaint (showing "Starting..." status + disabling
        // the Start button) before we hand off to a background task.
        isStartingRecording = true
        statusMessage = "Starting composite recording..."

        let micDeviceID = selectedMicDeviceID
        let camDeviceID = selectedCameraDeviceID
        let startToken = UUID()
        pendingCompositeStartToken = startToken
        activeCompositeRecordingToken = nil
        compositeStartWatchdogTask?.cancel()
        compositeStartWatchdogTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 12_000_000_000)
            self?.handleCompositeStartTimeout(
                token: startToken,
                outputURL: outputURL
            )
        }

        // Heavyweight writer setup OFF the main actor. Microphone startup
        // deliberately happens after the screen recorder is live; CoreAudio
        // can stall, and video should still start instead of pinning the UI
        // to "Starting..." forever.
        Task.detached(priority: .userInitiated) { [weak self] in
            let compositor = CompositeRecorder(
                bubbleController: BubblePositionController.shared,
                cameraCoordinator: CameraCaptureCoordinator.shared,
                displayBoundsProvider: { displayBounds }
            )
            do {
                try compositor.prepare(outputURL: outputURL, frameSize: pixelSize)
            } catch {
                await self?.failCompositeRecorderSetup(error, token: startToken)
                return
            }

            await self?.installLocalRecordingState(
                compositor: compositor,
                outputURL: outputURL,
                camDeviceID: camDeviceID,
                micDeviceID: micDeviceID,
                startToken: startToken
            )
        }
    }

    /// Main-actor tail of `startLocalRecording`. Wires callbacks,
    /// flips activeRecordingKind, and kicks the (already-async)
    /// screen capture. Split out so the off-main setup task can
    /// hop back here cleanly.
    @MainActor
    private func installLocalRecordingState(
        compositor: CompositeRecorder,
        outputURL: URL,
        camDeviceID: String?,
        micDeviceID: String?,
        startToken: UUID
    ) async {
        guard #available(macOS 14.0, *) else { return }
        guard let screenCaptureCoordinator else { return }

        // If the user discarded mid-setup, tear it back down.
        guard isStartingRecording, pendingCompositeStartToken == startToken else {
            _ = try? await compositor.finish()
            try? FileManager.default.removeItem(at: outputURL)
            return
        }

        CameraCaptureCoordinator.shared.requestPermissionAndStart(
            deviceID: camDeviceID
        )

        screenCaptureCoordinator.onScreenSampleBuffer = { [weak compositor] sampleBuffer in
            compositor?.appendScreenFrame(sampleBuffer)
        }

        compositeRecorder = compositor
        activeVideoRecordingStartedAt = Date()
        activeRecordingURL = outputURL
        activeRecordingKind = .video
        activeCompositeRecordingToken = startToken
        state = .recording
        isStartingRecording = false
        pendingCompositeStartToken = nil
        compositeStartWatchdogTask?.cancel()
        compositeStartWatchdogTask = nil

        do {
            let display = try await screenCaptureCoordinator.startFirstDisplayCapture()
            statusMessage = "Recording \(display.name) (composite with bubble)."
            startCompositeMicAsync(
                deviceID: micDeviceID,
                compositor: compositor,
                token: startToken
            )
        } catch {
            screenCaptureCoordinator.onScreenSampleBuffer = nil
            compositeRecorder = nil
            compositeMicCoordinator = nil
            activeVideoRecordingStartedAt = nil
            activeRecordingKind = nil
            activeCompositeRecordingToken = nil
            activeRecordingURL = nil
            state = .failed(message: error.localizedDescription)
            statusMessage = "Composite recording failed: \(error.localizedDescription)"
        }
    }

    private func failCompositeRecorderSetup(_ error: Error, token: UUID) {
        guard pendingCompositeStartToken == token else { return }
        pendingCompositeStartToken = nil
        activeCompositeRecordingToken = nil
        compositeStartWatchdogTask?.cancel()
        compositeStartWatchdogTask = nil
        isStartingRecording = false
        state = .failed(message: error.localizedDescription)
        statusMessage = "Composite recorder setup failed: \(error.localizedDescription)"
    }

    private func handleCompositeStartTimeout(token: UUID, outputURL: URL) {
        guard pendingCompositeStartToken == token, isStartingRecording else { return }
        pendingCompositeStartToken = nil
        activeCompositeRecordingToken = nil
        isStartingRecording = false
        state = .failed(message: "Video recorder took too long to start.")
        statusMessage = "Video recorder took too long to start. Try again, or check Screen Recording and Microphone permissions."
        try? FileManager.default.removeItem(at: outputURL)
    }

    private func startCompositeMicAsync(
        deviceID: String?,
        compositor: CompositeRecorder,
        token: UUID
    ) {
        pendingCompositeMicTask?.cancel()
        let micCoordinator = MicrophoneCaptureCoordinator()
        micCoordinator.onSampleBuffer = { [weak compositor] sampleBuffer in
            compositor?.appendMicSample(sampleBuffer)
        }
        micCoordinator.onLevel = { [weak self] level in
            Task { @MainActor in
                self?.recordAudioLevel(level)
            }
        }
        pendingCompositeMicTask = Task { [weak self, micCoordinator] in
            do {
                try await micCoordinator.startWithTimeout(
                    deviceID: deviceID,
                    outputURL: nil,
                    voiceProcessingEnabled: false
                )
            } catch {
                print("[recorder] mic start failed: \(error.localizedDescription)")
                self?.clearPendingCompositeMicTask(token: token)
                return
            }

            if Task.isCancelled {
                self?.stopLateCompositeMicCoordinator(micCoordinator)
                return
            }
            self?.installCompositeMicCoordinator(micCoordinator, token: token)
        }
    }

    private func installCompositeMicCoordinator(
        _ micCoordinator: MicrophoneCaptureCoordinator,
        token: UUID
    ) {
        guard activeCompositeRecordingToken == token,
              activeRecordingKind == .video
        else {
            stopLateCompositeMicCoordinator(micCoordinator)
            return
        }
        compositeMicCoordinator = micCoordinator
        pendingCompositeMicTask = nil
    }

    private func clearPendingCompositeMicTask(token: UUID) {
        guard activeCompositeRecordingToken == token else { return }
        pendingCompositeMicTask = nil
    }

    private func stopLateCompositeMicCoordinator(
        _ micCoordinator: MicrophoneCaptureCoordinator
    ) {
        Task {
            _ = try? await micCoordinator.stop()
        }
    }

    func stopLocalRecordingAndUpload() {
        guard #available(macOS 14.0, *) else { return }
        guard let screenCaptureCoordinator,
              let backendClient,
              let compositor = compositeRecorder as? CompositeRecorder
        else { return }
        let micCoordinator = compositeMicCoordinator
        let startedAt = activeVideoRecordingStartedAt ?? Date()
        compositeStartWatchdogTask?.cancel()
        pendingCompositeMicTask?.cancel()
        compositeStartWatchdogTask = nil
        pendingCompositeMicTask = nil
        pendingCompositeStartToken = nil
        activeCompositeRecordingToken = nil
        isStartingRecording = false
        compositeRecorder = nil
        compositeMicCoordinator = nil
        activeVideoRecordingStartedAt = nil

        // Clear activeRecordingKind IMMEDIATELY (instead of after the
        // upload completes) so the router can swap RecordingHomeView
        // out for the FinalizingHomeView right away. Without this,
        // the user sees no feedback after clicking Stop & upload —
        // the timer goes to 00:00 but the surface stays the same,
        // and they re-click thinking the first click missed.
        activeRecordingKind = nil
        state = .finalizing
        statusMessage = "Finalizing composite recording..."

        Task {
            do {
                // Stop screen capture first so no more frames arrive.
                try? await screenCaptureCoordinator.stop()
                screenCaptureCoordinator.onScreenSampleBuffer = nil

                // Stop mic — fire-and-forget the file (compositor has
                // the audio inline already).
                _ = try? await micCoordinator?.stop()

                // Finalize composite MP4.
                let outputURL = try await compositor.finish()
                let durationSeconds = max(Date().timeIntervalSince(startedAt), 1)
                let outputBytes = Self.fileSize(outputURL)
                recorderLog.notice(
                    "video upload: finalized composite bytes=\(outputBytes, privacy: .public) duration=\(durationSeconds, privacy: .public) path=\(outputURL.path, privacy: .public)"
                )

                state = .uploading(progress: 0.1)
                statusMessage = "Creating upload row..."
                let start = try await backendClient.startRecording(
                    StartRecordingRequest(
                        tracks: [.init(kind: .composite, mimeType: "video/mp4")],
                        resolution: "screen-native",
                        brandProfileId: nil
                    )
                )
                recorderLog.notice(
                    "video upload: backend row created id=\(start.recordingId, privacy: .public) slug=\(start.slug, privacy: .public)"
                )
                let uploader = MultipartUploadCoordinator(backend: backendClient)
                statusMessage = "Uploading video..."
                let parts = try await uploader.uploadFile(
                    url: outputURL,
                    recordingId: start.recordingId,
                    track: .composite
                ) { [weak self] progress in
                    await MainActor.run {
                        guard let self else { return }
                        let uploadProgress = 0.1 + (progress.fraction * 0.78)
                        self.state = .uploading(progress: min(uploadProgress, 0.88))
                        self.statusMessage = "Uploading video part \(progress.completedParts) of \(progress.totalParts)..."
                    }
                }
                recorderLog.notice(
                    "video upload: uploaded composite parts=\(parts.count, privacy: .public) recording=\(start.recordingId, privacy: .public)"
                )
                state = .uploading(progress: 0.9)
                statusMessage = "Processing recording..."
                let complete = try await backendClient.complete(
                    recordingId: start.recordingId,
                    request: CompleteRecordingRequest(
                        tracks: [.composite: parts],
                        durationSeconds: durationSeconds
                    )
                )
                recorderLog.notice(
                    "video upload: complete accepted slug=\(complete.slug, privacy: .public)"
                )
                state = .complete(slug: complete.slug)
                statusMessage = "Uploaded. Transcription will finish in the background."
                // Refresh the Recent strip so the freshly-uploaded
                // recording appears immediately instead of waiting
                // for the 60-second polling tick.
                _recentService?.refresh()
            } catch {
                recorderLog.error("video upload: failed \(error.localizedDescription, privacy: .public)")
                state = .failed(message: error.localizedDescription)
                statusMessage = "Composite upload failed: \(error.localizedDescription)"
            }
        }
    }

    /// Discard the active composite recording without uploading. Stops
    /// capture, finalizes the writer (so resources release cleanly),
    /// and best-effort deletes the temp file.
    func cancelLocalRecording() {
        guard #available(macOS 14.0, *) else { return }
        if isStartingRecording {
            compositeStartWatchdogTask?.cancel()
            pendingCompositeMicTask?.cancel()
            compositeStartWatchdogTask = nil
            pendingCompositeMicTask = nil
            pendingCompositeStartToken = nil
            activeCompositeRecordingToken = nil
            isStartingRecording = false
            state = .signedInIdle
            statusMessage = "Recording start cancelled."
            return
        }
        guard let screenCaptureCoordinator,
              let compositor = compositeRecorder as? CompositeRecorder
        else { return }
        let micCoordinator = compositeMicCoordinator
        let outputURL = activeRecordingURL
        compositeStartWatchdogTask?.cancel()
        pendingCompositeMicTask?.cancel()
        compositeStartWatchdogTask = nil
        pendingCompositeMicTask = nil
        pendingCompositeStartToken = nil
        activeCompositeRecordingToken = nil
        isStartingRecording = false
        compositeRecorder = nil
        compositeMicCoordinator = nil
        activeVideoRecordingStartedAt = nil
        activeRecordingKind = nil
        activeRecordingURL = nil
        state = .signedInIdle
        statusMessage = "Recording discarded."
        Task {
            try? await screenCaptureCoordinator.stop()
            screenCaptureCoordinator.onScreenSampleBuffer = nil
            _ = try? await micCoordinator?.stop()
            _ = try? await compositor.finish()
            if let outputURL {
                try? FileManager.default.removeItem(at: outputURL)
            }
        }
    }

    func startAudioNoteRecording() {
        recorderLog.notice("startAudioNoteRecording — entered (isStartingRecording=\(self.isStartingRecording, privacy: .public), activeRecordingKind=\(String(describing: self.activeRecordingKind), privacy: .public))")
        guard !isStartingRecording else {
            recorderLog.error("startAudioNoteRecording — blocked: isStartingRecording=true")
            statusMessage = "Another recording is still starting. Wait a moment, then try again."
            return
        }
        guard let audioNoteRecorder else {
            recorderLog.error("startAudioNoteRecording — blocked: audioNoteRecorder is nil")
            return
        }
        // SCStream + backend.startRecording can take 3-4 seconds.
        // Flip isStartingRecording so the button shows "Starting…"
        // and disables — without this the click looked dead.
        isStartingRecording = true
        state = .preparingPermissions
        statusMessage = "Starting audio note..."
        let trimmedTitle = audioTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let title: String?
        if trimmedTitle.isEmpty || trimmedTitle == autoSuggestedAudioTitle {
            title = nil
        } else {
            title = trimmedTitle
        }
        let includeMic = includeMicInAudioNote
        var includeSystemAudio = includeSystemAudioInAudioNote
        let meetingContext = meetingContext
        let microphoneDeviceID = selectedMicDeviceID
        let systemAudioCaptureMode = systemAudioCaptureMode
        let systemAudioDeviceID = selectedSystemAudioDeviceID
        meetingPromptContext = nil
        if includeSystemAudio &&
            systemAudioCaptureMode == .screenCaptureKit &&
            !Self.allowsAppleSystemAudioCapture
        {
            if includeMic {
                recorderLog.error("startAudioNoteRecording — Apple system audio blocked; falling back to mic-only")
                includeSystemAudio = false
                statusMessage = "Recording with mic only to keep call audio stable. Use the default System audio mode for call audio."
            } else {
                recorderLog.error("startAudioNoteRecording — blocked: Apple system audio disabled and mic is off")
                state = .signedInIdle
                statusMessage = "Turn on Mic or use the default System audio mode before starting."
                isStartingRecording = false
                return
            }
        }
        if includeSystemAudio && systemAudioCaptureMode == .audioDevice && systemAudioDeviceID == nil {
            recorderLog.error("startAudioNoteRecording — blocked: system audio device required")
            state = .signedInIdle
            statusMessage = "Choose a system audio device in Settings before starting."
            isStartingRecording = false
            return
        }
        recorderLog.notice("startAudioNoteRecording — Task launching (mic=\(includeMic, privacy: .public), sys=\(includeSystemAudio, privacy: .public), sysMode=\(systemAudioCaptureMode.rawValue, privacy: .public))")
        if let backendClient {
            liveTranscription.start(
                backend: backendClient,
                includeMic: includeMic,
                includeSystemAudio: includeSystemAudio,
                enabled: liveTranscriptionEnabled
            )
        }
        Task {
            do {
                let session = try await startAudioNoteSessionWithRetry(
                    recorder: audioNoteRecorder,
                    title: title,
                    includeMic: includeMic,
                    includeSystemAudio: includeSystemAudio,
                    meetingContext: meetingContext,
                    microphoneDeviceID: microphoneDeviceID,
                    systemAudioCaptureMode: systemAudioCaptureMode,
                    systemAudioDeviceID: systemAudioDeviceID
                )
                recorderLog.notice("startAudioNoteRecording — succeeded (backendId=\(session.backendRecordingId ?? "nil", privacy: .public), slug=\(session.backendSlug ?? "nil", privacy: .public), tracks=\(session.tracks.count, privacy: .public))")
                activeRecordingKind = .audio
                activeAudioRecordingStartedAt = Date()
                activeAudioRecordingSlug = session.backendSlug
                activeAudioRecordingId = session.backendRecordingId
                lastSyncedAudioTitle = title ?? ""
                audioTitleManuallyEdited = title != nil
                isAudioNotePaused = false
                audioNotePausedAt = nil
                audioNotePausedAccumulatedSeconds = 0
                liveNotesBody = ""
                startNotesAutosave()
                audioLevel = 0
                state = .recording
                statusMessage = "Recording audio note with \(session.tracks.count) track(s)."
                isStartingRecording = false
            } catch {
                liveTranscription.stop()
                recorderLog.error("startAudioNoteRecording — FAILED: \(error.localizedDescription, privacy: .public) (\(String(describing: error), privacy: .public))")
                activeRecordingKind = nil
                activeAudioRecordingStartedAt = nil
                state = .failed(message: error.localizedDescription)
                statusMessage = "Audio note failed to start: \(error.localizedDescription)"
                isStartingRecording = false
            }
        }
    }

    private func startAudioNoteSessionWithRetry(
        recorder: AudioNoteRecorder,
        title: String?,
        includeMic: Bool,
        includeSystemAudio: Bool,
        meetingContext: MeetingContext?,
        microphoneDeviceID: String?,
        systemAudioCaptureMode: SystemAudioCaptureMode,
        systemAudioDeviceID: String?
    ) async throws -> AudioRecordingSession {
        let maxAttempts = 3
        var lastError: Error?
        for attempt in 1...maxAttempts {
            do {
                recorderLog.notice("startAudioNoteRecording — calling audioNoteRecorder.start attempt=\(attempt, privacy: .public)")
                return try await recorder.start(
                    title: title,
                    includeMic: includeMic,
                    includeSystemAudio: includeSystemAudio,
                    meetingContext: meetingContext,
                    microphoneDeviceID: microphoneDeviceID,
                    systemAudioCaptureMode: systemAudioCaptureMode,
                    systemAudioDeviceID: systemAudioDeviceID
                )
            } catch {
                lastError = error
                guard Self.isTransientStartError(error), attempt < maxAttempts else {
                    throw error
                }
                let nextAttempt = attempt + 1
                recorderLog.warning(
                    "startAudioNoteRecording — transient start failure, retrying attempt=\(nextAttempt, privacy: .public)/\(maxAttempts, privacy: .public): \(error.localizedDescription, privacy: .public)"
                )
                statusMessage = "Loomola is temporarily unavailable. Retrying audio note start \(nextAttempt) of \(maxAttempts)..."
                try await Task.sleep(nanoseconds: UInt64(nextAttempt) * 1_000_000_000)
            }
        }
        throw lastError ?? AudioNoteStartRetryError.exhaustedWithoutError
    }

    /// Pause the active audio-note capture. The mic + system-audio
    /// engines stay running; their tap callbacks discard buffers while
    /// `paused == true`. The on-disk audio file naturally elides the
    /// gap. Resume is instant — no device re-acquisition.
    ///
    /// Safe to call only when an audio note recording is active and
    /// not already paused. UI gates this; defensive no-op otherwise.
    func pauseAudioNoteRecording() {
        guard let audioNoteRecorder,
              activeRecordingKind == .audio,
              !isAudioNotePaused
        else { return }
        audioNoteRecorder.pause()
        liveTranscription.pause()
        isAudioNotePaused = true
        audioNotePausedAt = Date()
    }

    /// Resume after a previous pauseAudioNoteRecording(). Recomputes
    /// total paused-time so the displayed timer + uploaded
    /// durationSeconds match the actual recorded audio duration.
    func resumeAudioNoteRecording() {
        guard let audioNoteRecorder,
              activeRecordingKind == .audio,
              isAudioNotePaused,
              let pausedAt = audioNotePausedAt
        else { return }
        audioNoteRecorder.resume()
        liveTranscription.resume()
        audioNotePausedAccumulatedSeconds += Date().timeIntervalSince(pausedAt)
        audioNotePausedAt = nil
        isAudioNotePaused = false
    }

    func stopAudioNoteRecordingAndUpload() {
        guard let audioNoteRecorder else { return }
        // Match the video Stop & upload pattern: clear
        // activeRecordingKind immediately so the router swaps to
        // FinalizingHomeView right away. Without this the audio
        // recording surface would stay up while the upload runs in
        // the background and the user might re-click thinking
        // nothing happened.
        notesAutosaveTask?.cancel()
        notesAutosaveTask = nil
        audioTitleAutosaveTask?.cancel()
        audioTitleAutosaveTask = nil
        let pendingMediaId = activeAudioRecordingId
        let pendingSlug = activeAudioRecordingSlug
        let pendingTitle = audioTitle
        let pendingBody = liveNotesBody
        if let pendingMediaId, let pendingSlug {
            let title = pendingTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            lastStoppedAudioRecordingForReview = RecentRecording(
                id: pendingMediaId,
                slug: pendingSlug,
                title: title.isEmpty ? "New note" : title,
                kind: .audio,
                createdAt: activeAudioRecordingStartedAt ?? Date(),
                durationSeconds: nil,
                status: "uploading",
                transcriptReady: liveTranscription.hasTranscriptText,
                thumbnailURL: nil,
                folderId: nil,
                folderName: nil
            )
        }
        activeRecordingKind = nil
        activeAudioRecordingStartedAt = nil
        activeAudioRecordingSlug = nil
        isAudioNotePaused = false
        audioNotePausedAt = nil
        audioNotePausedAccumulatedSeconds = 0
        // Keep activeAudioRecordingId until after the final flush.
        audioLevel = 0
        state = .finalizing
        statusMessage = "Finalizing audio note..."
        Task { [audioNoteRecorder] in
            // Snapshot the session BEFORE attempting the upload so
            // that on failure we still have a reference to the local
            // files (the recorder retains session through a thrown
            // stopAndUpload — it only clears on success).
            let preSnapshot = audioNoteRecorder.currentSessionSnapshot
            do {
                // Final notes flush BEFORE upload completes so the
                // server-side regen (Phase E) sees the user's full
                // typed content. Best-effort — failure here doesn't
                // abort the upload.
                if let mediaId = pendingMediaId, !pendingBody.isEmpty {
                    try? await backendClient?.putNoteBody(
                        mediaId: mediaId,
                        body: pendingBody
                    )
                }
                if let mediaId = pendingMediaId {
                    _ = await persistAudioTitle(mediaId: mediaId, title: pendingTitle)
                    let snapshot = await liveTranscription.finishAndSnapshot()
                    if !snapshot.fullText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        try? await backendClient?.persistLiveTranscript(
                            mediaId: mediaId,
                            snapshot: snapshot
                        )
                    }
                }
                state = .uploading(progress: 0.2)
                let complete = try await audioNoteRecorder.stopAndUpload()
                activeAudioRecordingId = nil
                liveNotesBody = ""
                state = .complete(slug: complete.slug)
                statusMessage = "Uploaded audio note. Slug: \(complete.slug)"
                _recentService?.refresh()
            } catch {
                // The upload failed (network, brownout, server error).
                // The recorder kept session.directory intact and left
                // the local files on disk in /var/folders. Copy them
                // somewhere durable BEFORE telling the user, so the
                // recovery offer in `state.failed` is real.
                let snapshot = audioNoteRecorder.currentSessionSnapshot ?? preSnapshot
                var captured: OrphanedRecording?
                if let snapshot {
                    let duration = max(Date().timeIntervalSince(snapshot.startedAt), 1)
                    do {
                        captured = try OrphanedRecordingStore.shared.capture(
                            from: snapshot,
                            durationSeconds: duration,
                            lastError: error.localizedDescription
                        )
                        // Detach the in-memory session — the orphan
                        // store owns the durable copy now.
                        audioNoteRecorder.detachSessionAfterOrphanSave()
                    } catch {
                        // Capture itself failed (very unusual — no
                        // disk space?). Surface but don't stomp the
                        // original upload error.
                        recorderLog.error("orphan capture failed: \(error.localizedDescription, privacy: .public)")
                    }
                }
                let recoveryHint = captured == nil
                    ? error.localizedDescription
                    : "\(error.localizedDescription) Recording saved locally — open Settings → Recovery to retry."
                state = .failed(message: recoveryHint)
                statusMessage = "Audio note upload failed: \(recoveryHint)"
            }
        }
    }

    func clearLastStoppedAudioRecordingForReview() {
        lastStoppedAudioRecordingForReview = nil
    }

    // MARK: - Live notes autosave

    func setAudioTitle(_ title: String) {
        audioTitle = title
        audioTitleManuallyEdited = isUserOwnedAudioTitle(title)
        scheduleAudioTitleAutosave()
    }

    private func isUserOwnedAudioTitle(_ title: String) -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed != autoSuggestedAudioTitle
    }

    private func scheduleAudioTitleAutosave() {
        audioTitleAutosaveTask?.cancel()
        guard activeRecordingKind == .audio, activeAudioRecordingId != nil else {
            return
        }
        audioTitleAutosaveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled else { return }
            _ = await self?.flushActiveAudioTitle()
        }
    }

    @discardableResult
    private func flushActiveAudioTitle() async -> Bool {
        guard let mediaId = activeAudioRecordingId else { return false }
        return await persistAudioTitle(mediaId: mediaId, title: audioTitle)
    }

    @discardableResult
    private func persistAudioTitle(mediaId: String, title: String) async -> Bool {
        guard let backendClient else { return false }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != autoSuggestedAudioTitle else { return false }
        guard trimmed != lastSyncedAudioTitle else { return true }

        do {
            try await backendClient.updateRecordingTitle(
                recordingId: mediaId,
                title: trimmed
            )
            lastSyncedAudioTitle = trimmed
            recorderLog.notice("audio title synced for \(mediaId, privacy: .public)")
            _recentService?.refresh()
            return true
        } catch {
            recorderLog.error("audio title sync failed for \(mediaId, privacy: .public): \(error.localizedDescription, privacy: .public)")
            statusMessage = "Couldn't save title yet. Loomola will retry when the note finishes."
            return false
        }
    }

    /// Background task that watches `liveNotesBody` for changes and
    /// debounces a PUT /api/notes/<mediaId> for the active recording.
    /// Lives only while an audio note is recording. Cancelled on
    /// stop / cancel / signOut.
    private var notesAutosaveTask: Task<Void, Never>?
    /// Last body successfully synced to the server. Avoids
    /// re-PUTting identical content on every debounce tick.
    private var lastSyncedNotesBody: String = ""

    private func startNotesAutosave() {
        notesAutosaveTask?.cancel()
        lastSyncedNotesBody = ""
        notesAutosaveTask = Task { [weak self] in
            // 2-second idle window: every time liveNotesBody
            // changes, restart the wait. After 2s of no edits, push
            // to the backend. The Combine-style "debounce" operator
            // would be cleaner but we don't import Combine here.
            var lastSeen: String = ""
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1s tick
                guard let self else { return }
                let current = self.liveNotesBody
                if current == lastSeen, current != self.lastSyncedNotesBody {
                    // Two consecutive ticks (~2s) of no change AND
                    // not yet synced → push to backend.
                    await self.flushLiveNotes()
                }
                lastSeen = current
            }
        }
    }

    @discardableResult
    private func flushLiveNotes() async -> Bool {
        guard let backendClient,
              let mediaId = activeAudioRecordingId
        else { return false }
        let body = liveNotesBody
        do {
            try await backendClient.putNoteBody(mediaId: mediaId, body: body)
            lastSyncedNotesBody = body
            return true
        } catch {
            print("[notes-autosave] PUT failed: \(error.localizedDescription)")
            return false
        }
    }

    @discardableResult
    func flushActiveAudioNoteDraft() async -> Bool {
        let notesOK = await flushLiveNotes()
        let titleOK = await flushActiveAudioTitle()
        return notesOK || titleOK
    }

    @discardableResult
    func persistActiveLiveTranscript() async -> Bool {
        guard let backendClient,
              let mediaId = activeAudioRecordingId
        else { return false }
        return await persistLiveTranscript(mediaId: mediaId, backend: backendClient)
    }

    @discardableResult
    func persistLiveTranscript(mediaId: String) async -> Bool {
        guard let backendClient else { return false }
        return await persistLiveTranscript(mediaId: mediaId, backend: backendClient)
    }

    @discardableResult
    private func persistLiveTranscript(mediaId: String, backend: BackendClient) async -> Bool {
        return await liveTranscription.persistSnapshot(
            mediaId: mediaId,
            backend: backend
        )
    }

    func applyGeneratedAudioNote(title: String?, body: String?) {
        if let title, !title.isEmpty, shouldApplyGeneratedAudioTitle {
            audioTitle = title
            lastSyncedAudioTitle = title
        }
        if let body, !body.isEmpty {
            liveNotesBody = body
            lastSyncedNotesBody = body
        }
    }

    private var shouldApplyGeneratedAudioTitle: Bool {
        !audioTitleManuallyEdited &&
            audioTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func discardActiveRecordingForQuit() async {
        switch activeRecordingKind {
        case .video:
            cancelLocalRecording()
        case .audio:
            await discardAudioNoteRecording()
        case nil:
            break
        }
    }

    func cancelAudioNoteRecording() {
        Task {
            await discardAudioNoteRecording()
        }
    }

    private func discardAudioNoteRecording() async {
        guard let audioNoteRecorder else { return }
        notesAutosaveTask?.cancel()
        notesAutosaveTask = nil
        audioTitleAutosaveTask?.cancel()
        audioTitleAutosaveTask = nil
        lastSyncedAudioTitle = ""
        audioTitleManuallyEdited = false
        state = .finalizing
        statusMessage = "Discarding audio note..."
        await audioNoteRecorder.cancel()
        liveTranscription.reset()
        activeRecordingKind = nil
        activeAudioRecordingStartedAt = nil
        activeAudioRecordingSlug = nil
        activeAudioRecordingId = nil
        isAudioNotePaused = false
        audioNotePausedAt = nil
        audioNotePausedAccumulatedSeconds = 0
        audioLevel = 0
        liveNotesBody = ""
        lastStoppedAudioRecordingForReview = nil
        state = .signedInIdle
        statusMessage = "Audio note discarded."
    }

    // MARK: - Orphan recovery

    /// While a retry is running we expose its orphan id so the UI
    /// can dim the row's Retry button. Nil between retries.
    @Published var orphanRetryInProgress: UUID?

    /// Re-runs the upload pipeline for an orphaned recording. Calls
    /// the same /api/recordings/start → multipart → /complete sequence
    /// the live flow uses, but driven from the durable on-disk copies
    /// of mic.m4a / system-audio.m4a in the orphan store.
    func retryOrphan(_ orphan: OrphanedRecording) {
        guard let backendClient else {
            statusMessage = "Cannot retry: not signed in."
            return
        }
        guard orphanRetryInProgress == nil else { return }
        orphanRetryInProgress = orphan.id
        statusMessage = "Retrying orphaned upload..."
        Task {
            let coordinator = OrphanRetryCoordinator(backend: backendClient)
            do {
                let outcome = try await coordinator.retry(orphan)
                try? OrphanedRecordingStore.shared.markRescued(
                    orphan,
                    rescuedSlug: outcome.slug
                )
                statusMessage = "Recovered audio note uploaded as \(outcome.slug)."
                _recentService?.refresh()
            } catch {
                try? OrphanedRecordingStore.shared.updateError(
                    orphan,
                    error: error.localizedDescription
                )
                statusMessage = "Retry failed: \(error.localizedDescription)"
            }
            orphanRetryInProgress = nil
        }
    }

    /// Permanently remove an orphan from the store + delete its local
    /// audio files. Caller is responsible for confirming rescue first.
    func discardOrphan(_ orphan: OrphanedRecording) {
        do {
            try OrphanedRecordingStore.shared.discard(orphan)
            statusMessage = "Discarded orphaned recording."
        } catch {
            statusMessage = "Could not discard recording: \(error.localizedDescription)"
        }
    }

    func syncPendingObsidianNotes() {
        syncPendingObsidianNotes(showStatus: true)
    }

    private func syncPendingObsidianNotes(showStatus: Bool) {
        guard let obsidianExportWriter else { return }
        guard !obsidianSyncInFlight else { return }
        obsidianSyncInFlight = true
        if showStatus {
            statusMessage = "Checking for pending Obsidian notes..."
        }
        Task {
            do {
                let count = try await obsidianExportWriter.syncPending()
                obsidianSyncInFlight = false
                if showStatus || count > 0 {
                    statusMessage = count == 0
                        ? "No Obsidian notes are pending."
                        : "Synced \(count) note(s) to Obsidian."
                }
            } catch {
                obsidianSyncInFlight = false
                if showStatus {
                    statusMessage = "Obsidian sync failed: \(error.localizedDescription)"
                }
            }
        }
    }

    private func apply(session: Session) {
        accessToken = session.accessToken
        recorderLog.notice("apply(session:) — accessToken set, state → signedInIdle")
        state = .signedInIdle
        if email.isEmpty {
            email = session.user.email ?? ""
        }
        // Eagerly construct the recent service if not yet built, then
        // kick a fresh refresh.
        //
        // Why both: signIn() flips state to .preparingPermissions
        // BEFORE this method runs (apply runs from the network task's
        // success continuation). That intermediate state often falls
        // through to IdleHomeView (when permissions are already
        // granted), which accesses viewModel.recentRecordings and
        // creates the service — at which point accessToken is still
        // nil and the service's init refresh() throws
        // missingAccessToken. The failure caches as
        // hasLoaded=true, items=[], and the strip stays empty until a
        // later trigger (60s timer, didBecomeActive, ScrollView
        // re-onAppear) happens to align with a token-having state.
        //
        // The first call below ensures the service exists at all (for
        // the cold-restore path where state goes straight from
        // .signedOut → .signedInIdle). The second call replaces any
        // failed first refresh with one that uses the now-valid
        // token (refresh() bails if a task is in flight, but the
        // failed-auth refresh completes within ms, so refreshTask
        // is reliably nil by the time apply() runs).
        _ = recentRecordings
        _recentService?.refresh()
        refreshChromeMeetingContext(showStatus: false)
        if canListCaptureSourcesWithoutPrompt() {
            refreshCaptureSources()
        }
        startObsidianAutoSync()
        startObsidianRealtimeSync(userId: session.user.id)
        if meetingDetectionEnabled {
            startMeetingWatch()
        }
        refreshUserPreferencesFromBackend()
    }

    func openActiveAudioNote() {
        let url = activeAudioRecordingSlug
            .map { webURL(pathComponents: ["notes", $0]) }
            ?? webURL()
        NSWorkspace.shared.open(url)
    }

    func openLibrary() {
        NSWorkspace.shared.open(webURL())
    }

    func openWebNote(slug: String) {
        NSWorkspace.shared.open(webURL(pathComponents: ["notes", slug]))
    }

    private func webURL(pathComponents: [String] = []) -> URL {
        var url = configuration?.apiBaseURL ?? URL(string: "https://loom.dissonance.cloud")!
        for component in pathComponents {
            url = url.appending(path: component)
        }
        return url
    }

    private func recordAudioLevel(_ level: Double) {
        let now = Date()
        guard now.timeIntervalSince(lastAudioLevelUpdate) >= 0.08 else { return }
        lastAudioLevelUpdate = now
        audioLevel = min(1, max(0, level))
    }

    private func syncPendingObsidianNotesFromRealtime() {
        syncPendingObsidianNotes(showStatus: false)
    }

    private func markObsidianRealtimeUnavailable() {
        obsidianRealtimeTask = nil
        statusMessage = "Realtime Obsidian sync is unavailable; 30-second backup sync is still running."
    }

    private func startObsidianAutoSync() {
        guard obsidianSyncTask == nil else { return }
        syncPendingObsidianNotes(showStatus: false)
        obsidianSyncTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: self?.obsidianSyncIntervalNanoseconds ?? 30_000_000_000)
                } catch {
                    return
                }
                self?.syncPendingObsidianNotes(showStatus: false)
            }
        }
    }

    private func startObsidianRealtimeSync(userId: UUID) {
        guard obsidianRealtimeTask == nil, let obsidianRealtimeSubscriber else { return }
        obsidianRealtimeTask = Task { [weak self] in
            do {
                try await obsidianRealtimeSubscriber.start(userId: userId) { [weak self] in
                    await self?.syncPendingObsidianNotesFromRealtime()
                }
            } catch is CancellationError {
                return
            } catch {
                self?.markObsidianRealtimeUnavailable()
            }
        }
    }

    private func startMeetingWatch() {
        guard meetingDetectionEnabled else { return }
        guard meetingWatchTask == nil else { return }
        refreshChromeMeetingContext(showStatus: false)
        // The idle meeting-watch loop is intentionally minimal: it
        // only reads the Chrome extension's signal file from disk
        // (~1ms). It used to also call SCShareableContent.current as
        // a fallback for non-extension users — but that enumerates
        // every window in the session (~10–50ms of WindowServer +
        // kernel work, ~240 calls/hour), which is wasteful on a
        // background-running app. SCShareableContent still runs on
        // explicit user actions (Settings → Refresh Sources, or
        // start-of-recording), and the heuristic detector via
        // MeetingDetector.detect(from:) gets called on those refresh
        // paths — so detection still works for non-Chrome users,
        // just at user-driven cadence rather than every 15s.
        meetingWatchTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: self?.meetingWatchIntervalNanoseconds ?? 15_000_000_000)
                } catch {
                    return
                }
                self?.refreshChromeMeetingContext(showStatus: false)
            }
        }
    }

    @discardableResult
    private func refreshChromeMeetingContext(showStatus: Bool) -> Bool {
        guard let context = ChromeMeetingSignalStore.readLatest() else { return false }
        let previousContext = meetingContext
        applyMeetingContext(context)
        if showStatus || context != previousContext {
            statusMessage = "Detected \(context.detectedApp): \(context.sourceContextHint)"
        }
        if context != previousContext && activeRecordingKind == nil {
            AppActivation.bringRecorderToFront()
        }
        return true
    }

    private func applyMeetingContext(_ context: MeetingContext?) {
        meetingContext = context
        guard let context else {
            meetingPromptContext = nil
            dismissedMeetingContext = nil
            if audioTitle == autoSuggestedAudioTitle {
                audioTitle = ""
            }
            audioTitleManuallyEdited = isUserOwnedAudioTitle(audioTitle)
            autoSuggestedAudioTitle = nil
            return
        }

        if audioTitle == autoSuggestedAudioTitle {
            audioTitle = ""
        }
        audioTitleManuallyEdited = isUserOwnedAudioTitle(audioTitle)
        autoSuggestedAudioTitle = context.suggestedTitle

        if dismissedMeetingContext != context && activeRecordingKind == nil {
            meetingPromptContext = context
        }
    }

    private func currentAccessToken() -> String? {
        accessToken
    }

    private func canListCaptureSourcesWithoutPrompt() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    private static func fileSize(_ url: URL) -> Int64 {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes?[.size] as? NSNumber)?.int64Value ?? 0
    }

    private static func isTransientStartError(_ error: Error) -> Bool {
        if let backendError = error as? BackendClientError {
            return backendError.isTransient
        }
        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain else { return false }
        return [
            NSURLErrorTimedOut,
            NSURLErrorCannotFindHost,
            NSURLErrorCannotConnectToHost,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorNotConnectedToInternet
        ].contains(nsError.code)
    }
}

enum RecorderState: Equatable {
    case signedOut
    case signedInIdle
    case preparingPermissions
    case readyToRecord
    case recording
    case paused
    case finalizing
    case uploading(progress: Double)
    case complete(slug: String)
    case failed(message: String)

    var label: String {
        switch self {
        case .signedOut: return "Signed out"
        case .signedInIdle: return "Ready"
        case .preparingPermissions: return "Permissions"
        case .readyToRecord: return "Ready"
        case .recording: return "Recording"
        case .paused: return "Paused"
        case .finalizing: return "Finalizing"
        case .uploading: return "Uploading"
        case .complete: return "Complete"
        case .failed: return "Failed"
        }
    }

    var isRecordingLike: Bool {
        self == .recording || self == .paused
    }
}

enum DesktopRecordingKind: Equatable {
    case video
    case audio
}

enum RecorderViewModelError: Error {
    case missingAccessToken
}

private enum AudioNoteStartRetryError: LocalizedError {
    case exhaustedWithoutError

    var errorDescription: String? {
        "Audio note could not start after retrying."
    }
}

enum RestoreSessionError: Error {
    case timedOut
}

/// One-shot resolver for the restoreSession timeout race. The first
/// caller wins; subsequent calls are silently ignored. Lock-protected
/// so the two racing tasks don't double-resume the continuation.
private final class RestoreResolver: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Session?, Error>?

    init(_ continuation: CheckedContinuation<Session?, Error>) {
        self.continuation = continuation
    }

    func resolve(_ result: Result<Session?, Error>) {
        lock.lock()
        guard let continuation else {
            lock.unlock()
            return
        }
        self.continuation = nil
        lock.unlock()
        switch result {
        case .success(let value): continuation.resume(returning: value)
        case .failure(let error): continuation.resume(throwing: error)
        }
    }
}
