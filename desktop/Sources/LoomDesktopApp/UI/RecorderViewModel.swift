import AppKit
import CoreGraphics
import Foundation
import Supabase

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
    @Published private(set) var activeVideoRecordingStartedAt: Date?
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
        let backend = backendClient ?? BackendClient(
            baseURL: configuration?.apiBaseURL ?? URL(string: "https://loom.dissonance.cloud")!
        ) { throw RecorderViewModelError.missingAccessToken }
        let service = RecentRecordingsService(backend: backend)
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
        guard let authService else { return }
        do {
            if let session = try await authService.restoreSession() {
                apply(session: session)
                statusMessage = "Signed in from Keychain."
            }
        } catch {
            statusMessage = "Saved session could not be restored. Sign in again."
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
        guard let screenCaptureCoordinator else {
            statusMessage = "ScreenCaptureKit requires macOS 14 or newer."
            return
        }
        guard let screen = NSScreen.main else {
            statusMessage = "No active display found."
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

        // Build the composite recorder. Pulls camera frames + bubble
        // placement from the shared singletons so the bubble overlay
        // (in AppDelegate) and the compositor see the same state.
        let compositor = CompositeRecorder(
            bubbleController: BubblePositionController.shared,
            cameraCoordinator: CameraCaptureCoordinator.shared,
            displayBoundsProvider: { displayBounds }
        )
        do {
            try compositor.prepare(outputURL: outputURL, frameSize: pixelSize)
        } catch {
            state = .failed(message: error.localizedDescription)
            statusMessage = "Composite recorder setup failed: \(error.localizedDescription)"
            return
        }

        // Mic capture with AEC. Writes its own M4A (we discard it for
        // now — composite contains the mic audio); compositor uses the
        // onSampleBuffer hook to mux mic samples into the MP4. onLevel
        // feeds the recording HUD's level meter via recordAudioLevel.
        let micCoordinator = MicrophoneCaptureCoordinator()
        let micURL = FileManager.default.temporaryDirectory
            .appending(path: "loom-composite-mic-\(UUID().uuidString).m4a")
        micCoordinator.onSampleBuffer = { [weak compositor] sampleBuffer in
            compositor?.appendMicSample(sampleBuffer)
        }
        micCoordinator.onLevel = { [weak self] level in
            Task { @MainActor in
                self?.recordAudioLevel(level)
            }
        }
        do {
            try micCoordinator.start(deviceID: selectedMicDeviceID, outputURL: micURL)
        } catch {
            // Mic failure is non-fatal — recording continues with video
            // only. Log + statusMessage so user knows.
            print("[recorder] mic start failed: \(error.localizedDescription)")
        }

        // Start the camera coordinator (idempotent — bubble overlay
        // may have already started it). Compositor reads from
        // CameraCaptureCoordinator.shared.latestPixelBuffer().
        CameraCaptureCoordinator.shared.requestPermissionAndStart(
            deviceID: selectedCameraDeviceID
        )

        // Hook screen sample buffer → compositor.
        screenCaptureCoordinator.onScreenSampleBuffer = { [weak compositor] sampleBuffer in
            compositor?.appendScreenFrame(sampleBuffer)
        }

        compositeRecorder = compositor
        compositeMicCoordinator = micCoordinator
        activeVideoRecordingStartedAt = Date()
        activeRecordingURL = outputURL
        activeRecordingKind = .video
        state = .recording
        statusMessage = "Starting composite recording..."

        Task {
            do {
                let display = try await screenCaptureCoordinator.startFirstDisplayCapture()
                statusMessage = "Recording \(display.name) (composite with bubble)."
            } catch {
                screenCaptureCoordinator.onScreenSampleBuffer = nil
                _ = try? await micCoordinator.stop()
                compositeRecorder = nil
                compositeMicCoordinator = nil
                activeVideoRecordingStartedAt = nil
                activeRecordingKind = nil
                state = .failed(message: error.localizedDescription)
                statusMessage = "Composite recording failed: \(error.localizedDescription)"
            }
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
        compositeRecorder = nil
        compositeMicCoordinator = nil
        activeVideoRecordingStartedAt = nil

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
                activeRecordingKind = nil
                state = .complete(slug: complete.slug)
                statusMessage = "Uploaded. Recording slug: \(complete.slug)"
            } catch {
                activeRecordingKind = nil
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
        guard let screenCaptureCoordinator,
              let compositor = compositeRecorder as? CompositeRecorder
        else { return }
        let micCoordinator = compositeMicCoordinator
        let outputURL = activeRecordingURL
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
        guard let audioNoteRecorder else { return }
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
        meetingPromptContext = nil
        Task {
            do {
                let session = try await audioNoteRecorder.start(
                    title: title,
                    includeMic: includeMic,
                    includeSystemAudio: includeSystemAudio,
                    meetingContext: meetingContext
                )
                activeRecordingKind = .audio
                activeAudioRecordingStartedAt = Date()
                activeAudioRecordingSlug = session.backendSlug
                audioLevel = 0
                state = .recording
                statusMessage = "Recording audio note with \(session.tracks.count) track(s)."
            } catch {
                activeRecordingKind = nil
                activeAudioRecordingStartedAt = nil
                state = .failed(message: error.localizedDescription)
                statusMessage = "Audio note failed to start: \(error.localizedDescription)"
            }
        }
    }

    func stopAudioNoteRecordingAndUpload() {
        guard let audioNoteRecorder else { return }
        state = .finalizing
        statusMessage = "Finalizing audio note..."
        Task {
            do {
                state = .uploading(progress: 0.2)
                let complete = try await audioNoteRecorder.stopAndUpload()
                activeRecordingKind = nil
                activeAudioRecordingStartedAt = nil
                activeAudioRecordingSlug = nil
                audioLevel = 0
                state = .complete(slug: complete.slug)
                statusMessage = "Uploaded audio note. Slug: \(complete.slug)"
            } catch {
                activeRecordingKind = nil
                activeAudioRecordingStartedAt = nil
                activeAudioRecordingSlug = nil
                audioLevel = 0
                state = .failed(message: error.localizedDescription)
                statusMessage = "Audio note upload failed: \(error.localizedDescription)"
            }
        }
    }

    func cancelAudioNoteRecording() {
        guard let audioNoteRecorder else { return }
        state = .finalizing
        statusMessage = "Discarding audio note..."
        Task {
            await audioNoteRecorder.cancel()
            activeRecordingKind = nil
            activeAudioRecordingStartedAt = nil
            activeAudioRecordingSlug = nil
            audioLevel = 0
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
                    await MainActor.run {
                        self?.syncPendingObsidianNotes(showStatus: false)
                    }
                }
            } catch is CancellationError {
                return
            } catch {
                await MainActor.run {
                    self?.obsidianRealtimeTask = nil
                    self?.statusMessage = "Realtime Obsidian sync is unavailable; 30-second backup sync is still running."
                }
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
