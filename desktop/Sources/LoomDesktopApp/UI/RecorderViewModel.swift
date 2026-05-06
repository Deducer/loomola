import AppKit
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
    @Published var includeMicInAudioNote = true
    @Published var includeSystemAudioInAudioNote = true
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
    /// AudioNoteRecorder.isPaused but kept as an @Published mirror
    /// so SwiftUI re-renders on transition.
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
    private var obsidianExportWriter: ObsidianExportWriter?
    private var obsidianRealtimeSubscriber: ObsidianRealtimeSubscriber?
    private var obsidianSyncTask: Task<Void, Never>?
    private var obsidianRealtimeTask: Task<Void, Never>?
    private var meetingWatchTask: Task<Void, Never>?
    private var obsidianSyncInFlight = false
    private var dismissedMeetingContext: MeetingContext?
    private var autoSuggestedAudioTitle: String?
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
                return recorder
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
            await obsidianRealtimeSubscriber?.stop()
            obsidianSyncTask = nil
            obsidianRealtimeTask = nil
            meetingWatchTask = nil
            obsidianSyncInFlight = false
            meetingContext = nil
            meetingPromptContext = nil
            dismissedMeetingContext = nil
            autoSuggestedAudioTitle = nil
            activeAudioRecordingSlug = nil
            activeAudioRecordingId = nil
            audioLevel = 0
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

                state = .uploading(progress: 0.1)
                statusMessage = "Creating upload row..."
                let start = try await backendClient.startRecording(
                    StartRecordingRequest(
                        tracks: [.init(kind: .composite, mimeType: "video/mp4")],
                        resolution: "screen-native",
                        brandProfileId: nil
                    )
                )
                let uploader = MultipartUploadCoordinator(backend: backendClient)
                statusMessage = "Uploading composite MP4..."
                let parts = try await uploader.uploadFile(
                    url: outputURL,
                    recordingId: start.recordingId,
                    track: .composite
                )
                state = .uploading(progress: 0.9)
                let complete = try await backendClient.complete(
                    recordingId: start.recordingId,
                    request: CompleteRecordingRequest(
                        tracks: [.composite: parts],
                        durationSeconds: durationSeconds
                    )
                )
                state = .complete(slug: complete.slug)
                statusMessage = "Uploaded. Recording slug: \(complete.slug)"
                // Refresh the Recent strip so the freshly-uploaded
                // recording appears immediately instead of waiting
                // for the 60-second polling tick.
                _recentService?.refresh()
            } catch {
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
        guard !isStartingRecording else {
            statusMessage = "Another recording is still starting. Wait a moment, then try again."
            return
        }
        guard let audioNoteRecorder else { return }
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
        let includeSystemAudio = includeSystemAudioInAudioNote
        let meetingContext = meetingContext
        let microphoneDeviceID = selectedMicDeviceID
        meetingPromptContext = nil
        Task {
            do {
                let session = try await audioNoteRecorder.start(
                    title: title,
                    includeMic: includeMic,
                    includeSystemAudio: includeSystemAudio,
                    meetingContext: meetingContext,
                    microphoneDeviceID: microphoneDeviceID
                )
                activeRecordingKind = .audio
                activeAudioRecordingStartedAt = Date()
                activeAudioRecordingSlug = session.backendSlug
                activeAudioRecordingId = session.backendRecordingId
                liveNotesBody = ""
                startNotesAutosave()
                audioLevel = 0
                state = .recording
                statusMessage = "Recording audio note with \(session.tracks.count) track(s)."
                isStartingRecording = false
            } catch {
                activeRecordingKind = nil
                activeAudioRecordingStartedAt = nil
                state = .failed(message: error.localizedDescription)
                statusMessage = "Audio note failed to start: \(error.localizedDescription)"
                isStartingRecording = false
            }
        }
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
        let pendingMediaId = activeAudioRecordingId
        let pendingBody = liveNotesBody
        activeRecordingKind = nil
        activeAudioRecordingStartedAt = nil
        activeAudioRecordingSlug = nil
        // Keep activeAudioRecordingId until after the final flush.
        audioLevel = 0
        state = .finalizing
        statusMessage = "Finalizing audio note..."
        Task {
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
                state = .uploading(progress: 0.2)
                let complete = try await audioNoteRecorder.stopAndUpload()
                activeAudioRecordingId = nil
                liveNotesBody = ""
                state = .complete(slug: complete.slug)
                statusMessage = "Uploaded audio note. Slug: \(complete.slug)"
                _recentService?.refresh()
            } catch {
                state = .failed(message: error.localizedDescription)
                statusMessage = "Audio note upload failed: \(error.localizedDescription)"
            }
        }
    }

    // MARK: - Live notes autosave

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

    func cancelAudioNoteRecording() {
        guard let audioNoteRecorder else { return }
        notesAutosaveTask?.cancel()
        notesAutosaveTask = nil
        state = .finalizing
        statusMessage = "Discarding audio note..."
        Task {
            await audioNoteRecorder.cancel()
            activeRecordingKind = nil
            activeAudioRecordingStartedAt = nil
            activeAudioRecordingSlug = nil
            activeAudioRecordingId = nil
            audioLevel = 0
            liveNotesBody = ""
            state = .signedInIdle
            statusMessage = "Audio note discarded."
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
        refreshChromeMeetingContext(showStatus: false)
        if canListCaptureSourcesWithoutPrompt() {
            refreshCaptureSources()
        }
        startObsidianAutoSync()
        startObsidianRealtimeSync(userId: session.user.id)
        startMeetingWatch()
    }

    func openActiveAudioNote() {
        guard let configuration else { return }
        let url = activeAudioRecordingSlug
            .map { configuration.apiBaseURL.appending(path: "notes").appending(path: $0) }
            ?? configuration.apiBaseURL
        NSWorkspace.shared.open(url)
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
            autoSuggestedAudioTitle = nil
            return
        }

        if audioTitle == autoSuggestedAudioTitle {
            audioTitle = ""
        }
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
