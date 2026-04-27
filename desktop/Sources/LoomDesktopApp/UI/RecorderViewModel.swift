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
            statusMessage = "Ready to sign in."
            Task { await restoreSession() }
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
