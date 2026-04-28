import Foundation
import Supabase

@MainActor
final class RecorderViewModel: ObservableObject {
    @Published private(set) var state: RecorderState = .signedOut
    @Published var email = ""
    @Published var password = ""
    @Published private(set) var statusMessage = "Set LOOM_SUPABASE_URL and LOOM_SUPABASE_ANON_KEY, then sign in."
    @Published private(set) var configuration: DesktopAuthConfiguration?
    @Published private(set) var captureSources = CaptureSourceSnapshot(
        displays: [],
        windows: [],
        cameras: [],
        microphones: []
    )

    private var authService: DesktopAuthService?
    private var accessToken: String?
    private var backendClient: BackendClient?
    private let captureSourceProvider: CaptureSourceProvider?
    private let screenCaptureCoordinator: ScreenCaptureCoordinator?
    private var activeRecordingURL: URL?

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
            try? await authService.signOut()
            accessToken = nil
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

    func refreshCaptureSources() {
        guard let captureSourceProvider else {
            statusMessage = "ScreenCaptureKit source listing requires macOS 14 or newer."
            return
        }
        statusMessage = "Refreshing capture sources..."
        Task {
            do {
                captureSources = try await captureSourceProvider.snapshot()
                statusMessage = "Found \(captureSources.displays.count) display(s), \(captureSources.windows.count) window(s), \(captureSources.cameras.count) camera(s), and \(captureSources.microphones.count) mic(s)."
            } catch {
                statusMessage = "Could not list capture sources: \(error.localizedDescription)"
            }
        }
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
        state = .recording
        statusMessage = "Starting local MP4 recording..."
        Task {
            do {
                let display = try await screenCaptureCoordinator.startFirstDisplayRecording(outputURL: outputURL)
                statusMessage = "Recording \(display.name) to a local MP4."
            } catch {
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
                state = .complete(slug: complete.slug)
                statusMessage = "Uploaded. Recording slug: \(complete.slug)"
            } catch {
                state = .failed(message: error.localizedDescription)
                statusMessage = "Recording upload failed: \(error.localizedDescription)"
            }
        }
    }

    private func apply(session: Session) {
        accessToken = session.accessToken
        state = .signedInIdle
        if email.isEmpty {
            email = session.user.email ?? ""
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

enum RecorderViewModelError: Error {
    case missingAccessToken
}
