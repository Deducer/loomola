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
    @Published private(set) var statusMessage = "Set LOOM_SUPABASE_URL and LOOM_SUPABASE_ANON_KEY, then sign in."
    @Published private(set) var configuration: DesktopAuthConfiguration?
    @Published private(set) var activeRecordingKind: DesktopRecordingKind?
    @Published private(set) var meetingContext: MeetingContext?
    @Published private(set) var meetingPromptContext: MeetingContext?
    @Published private(set) var captureSources = CaptureSourceSnapshot(
        displays: [],
        windows: [],
        cameras: [],
        microphones: []
    )

    private var authService: DesktopAuthService?
    private var accessToken: String?
    private var backendClient: BackendClient?
    private var audioNoteRecorder: AudioNoteRecorder?
    private var obsidianExportWriter: ObsidianExportWriter?
    private var obsidianSyncTask: Task<Void, Never>?
    private var meetingWatchTask: Task<Void, Never>?
    private var obsidianSyncInFlight = false
    private var dismissedMeetingContext: MeetingContext?
    private var autoSuggestedAudioTitle: String?
    private let captureSourceProvider: CaptureSourceProvider?
    private let screenCaptureCoordinator: ScreenCaptureCoordinator?
    private var activeRecordingURL: URL?
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
            audioNoteRecorder = backendClient.map { AudioNoteRecorder(backend: $0) }
            obsidianExportWriter = backendClient.map { ObsidianExportWriter(backend: $0) }
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
            meetingWatchTask?.cancel()
            obsidianSyncTask = nil
            meetingWatchTask = nil
            obsidianSyncInFlight = false
            meetingContext = nil
            meetingPromptContext = nil
            dismissedMeetingContext = nil
            autoSuggestedAudioTitle = nil
            try? await authService.signOut()
            accessToken = nil
            activeRecordingKind = nil
            state = .signedOut
            statusMessage = "Signed out."
        }
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
        statusMessage = "Creating a Granola audio recording row..."
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
        if audioTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let suggested = meetingPromptContext?.suggestedTitle ?? meetingContext?.suggestedTitle {
            audioTitle = suggested
            autoSuggestedAudioTitle = suggested
        }
        meetingPromptContext = nil
        startAudioNoteRecording()
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
        guard let screenCaptureCoordinator else {
            statusMessage = "ScreenCaptureKit requires macOS 14 or newer."
            return
        }
        let outputURL = FileManager.default.temporaryDirectory
            .appending(path: "loom-desktop-\(UUID().uuidString).mp4")
        activeRecordingURL = outputURL
        activeRecordingKind = .video
        state = .recording
        statusMessage = "Starting local MP4 recording..."
        Task {
            do {
                let display = try await screenCaptureCoordinator.startFirstDisplayRecording(outputURL: outputURL)
                statusMessage = "Recording \(display.name) to a local MP4."
            } catch {
                activeRecordingKind = nil
                state = .failed(message: error.localizedDescription)
                statusMessage = "Local recording failed: \(error.localizedDescription)"
            }
        }
    }

    func stopLocalRecordingAndUpload() {
        guard let screenCaptureCoordinator, let backendClient else { return }
        state = .finalizing
        statusMessage = "Finalizing local MP4..."
        Task {
            do {
                let file = try await screenCaptureCoordinator.stopRecording()
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
                    url: file.url,
                    recordingId: start.recordingId,
                    track: .composite
                )
                state = .uploading(progress: 0.9)
                let complete = try await backendClient.complete(
                    recordingId: start.recordingId,
                    request: CompleteRecordingRequest(
                        tracks: [.composite: parts],
                        durationSeconds: max(file.durationSeconds, 1)
                    )
                )
                activeRecordingKind = nil
                state = .complete(slug: complete.slug)
                statusMessage = "Uploaded. Recording slug: \(complete.slug)"
            } catch {
                activeRecordingKind = nil
                state = .failed(message: error.localizedDescription)
                statusMessage = "Recording upload failed: \(error.localizedDescription)"
            }
        }
    }

    func startAudioNoteRecording() {
        guard let audioNoteRecorder else { return }
        state = .preparingPermissions
        statusMessage = "Starting Granola audio note..."
        let title = audioTitle
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
                state = .recording
                statusMessage = "Recording audio note with \(session.tracks.count) track(s)."
            } catch {
                activeRecordingKind = nil
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
                state = .complete(slug: complete.slug)
                statusMessage = "Uploaded audio note. Slug: \(complete.slug)"
            } catch {
                activeRecordingKind = nil
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
        refreshCaptureSources()
        startObsidianAutoSync()
        startMeetingWatch()
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

    private func startMeetingWatch() {
        guard meetingWatchTask == nil else { return }
        refreshChromeMeetingContext(showStatus: false)
        meetingWatchTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: self?.meetingWatchIntervalNanoseconds ?? 15_000_000_000)
                } catch {
                    return
                }
                self?.refreshChromeMeetingContext(showStatus: false)
                self?.refreshCaptureSources(showStatus: false)
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
        return true
    }

    private func applyMeetingContext(_ context: MeetingContext?) {
        meetingContext = context
        guard let context else {
            meetingPromptContext = nil
            dismissedMeetingContext = nil
            return
        }

        if audioTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            audioTitle == autoSuggestedAudioTitle {
            audioTitle = context.suggestedTitle
            autoSuggestedAudioTitle = context.suggestedTitle
        }

        if dismissedMeetingContext != context && activeRecordingKind == nil {
            meetingPromptContext = context
        }
    }

    private func currentAccessToken() -> String? {
        accessToken
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
