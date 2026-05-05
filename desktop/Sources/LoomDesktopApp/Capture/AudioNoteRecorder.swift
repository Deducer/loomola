import Foundation

@MainActor
final class AudioNoteRecorder {
    var onAudioLevel: ((Double) -> Void)?

    private let backend: BackendClient
    private let microphoneCapture = MicrophoneCaptureCoordinator()
    private let systemAudioCapture: SystemAudioCaptureCoordinator?
    private var session: AudioRecordingSession?

    init(backend: BackendClient) {
        self.backend = backend
        if #available(macOS 14.0, *) {
            systemAudioCapture = SystemAudioCaptureCoordinator()
        } else {
            systemAudioCapture = nil
        }
    }

    func start(
        title: String?,
        includeMic: Bool,
        includeSystemAudio: Bool,
        meetingContext: MeetingContext? = nil,
        microphoneDeviceID: String? = nil
    ) async throws -> AudioRecordingSession {
        guard session == nil else {
            throw AudioNoteRecorderError.alreadyRecording
        }

        var tracks = Set<TrackKind>()
        if includeMic { tracks.insert(.mic) }
        if includeSystemAudio { tracks.insert(.systemAudio) }
        guard !tracks.isEmpty else {
            throw AudioNoteRecorderError.noTracksSelected
        }

        let audioLevelSink = onAudioLevel
        microphoneCapture.onLevel = { level in
            audioLevelSink?(level)
        }
        systemAudioCapture?.onLevel = { level in
            audioLevelSink?(level)
        }

        let directory = try Self.createSessionDirectory()
        var nextSession = AudioRecordingSession(
            directory: directory,
            title: title?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            tracks: tracks,
            meetingContext: meetingContext
        )
        let response = try await backend.startRecording(nextSession.startRequest)
        nextSession.backendRecordingId = response.recordingId
        nextSession.backendSlug = response.slug
        session = nextSession

        do {
            if tracks.contains(.mic) {
                guard let url = nextSession.localFileURL(for: .mic) else {
                    throw AudioNoteRecorderError.missingLocalFileURL
                }
                try microphoneCapture.start(deviceID: microphoneDeviceID, outputURL: url)
            }
            if tracks.contains(.systemAudio) {
                guard let url = nextSession.localFileURL(for: .systemAudio) else {
                    throw AudioNoteRecorderError.missingLocalFileURL
                }
                guard let systemAudioCapture else {
                    throw AudioNoteRecorderError.systemAudioUnavailable
                }
                try await systemAudioCapture.start(outputURL: url)
            }
            return nextSession
        } catch {
            await cancel()
            throw error
        }
    }

    func stopAndUpload() async throws -> CompleteRecordingResponse {
        guard let session else {
            throw AudioNoteRecorderError.notRecording
        }
        guard let recordingId = session.backendRecordingId else {
            throw AudioNoteRecorderError.missingBackendRecordingId
        }

        var localFiles: [TrackKind: URL] = [:]
        if session.tracks.contains(.mic) {
            // The audio-note flow always supplies a URL when calling
            // start(deviceID:outputURL:), so stop() returns a non-nil
            // URL. Force-unwrap is safe here; if it ever becomes nil
            // the throw on the next branch (no completed tracks)
            // surfaces the failure.
            if let micURL = try await microphoneCapture.stop() {
                localFiles[.mic] = micURL
            }
        }
        if session.tracks.contains(.systemAudio), let systemAudioCapture {
            localFiles[.systemAudio] = try await systemAudioCapture.stop()
        }

        let uploader = MultipartUploadCoordinator(backend: backend)
        var completedTracks: [TrackKind: [CompletedPart]] = [:]
        for track in [TrackKind.mic, .systemAudio] {
            guard let fileURL = localFiles[track] else { continue }
            let parts = try await uploader.uploadFile(
                url: fileURL,
                recordingId: recordingId,
                track: track
            )
            if !parts.isEmpty {
                completedTracks[track] = parts
            }
        }
        guard !completedTracks.isEmpty else {
            throw AudioNoteRecorderError.noCompletedAudioTracks
        }

        let response = try await backend.complete(
            recordingId: recordingId,
            request: CompleteRecordingRequest(
                tracks: completedTracks,
                durationSeconds: max(Date().timeIntervalSince(session.startedAt), 1)
            )
        )
        try? FileManager.default.removeItem(at: session.directory)
        self.session = nil
        return response
    }

    func cancel() async {
        guard let session else { return }
        if session.tracks.contains(.mic) {
            _ = try? await microphoneCapture.stop()
        }
        if session.tracks.contains(.systemAudio), let systemAudioCapture {
            _ = try? await systemAudioCapture.stop()
        }
        if let recordingId = session.backendRecordingId {
            try? await backend.abort(recordingId: recordingId)
        }
        try? FileManager.default.removeItem(at: session.directory)
        self.session = nil
    }

    private static func createSessionDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "loom-audio-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}

enum AudioNoteRecorderError: LocalizedError {
    case alreadyRecording
    case noTracksSelected
    case notRecording
    case missingBackendRecordingId
    case missingLocalFileURL
    case systemAudioUnavailable
    case noCompletedAudioTracks

    var errorDescription: String? {
        switch self {
        case .alreadyRecording:
            return "An audio note is already recording."
        case .noTracksSelected:
            return "Choose microphone, system audio, or both before starting."
        case .notRecording:
            return "There is no active audio note recording to stop."
        case .missingBackendRecordingId:
            return "The audio note has no backend recording ID."
        case .missingLocalFileURL:
            return "The audio note is missing a local file path."
        case .systemAudioUnavailable:
            return "System audio capture requires macOS 14 or newer."
        case .noCompletedAudioTracks:
            return "No audio was captured. Check microphone and Screen & System Audio permissions, then try again."
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
