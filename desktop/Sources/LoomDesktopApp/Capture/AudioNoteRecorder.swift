import Foundation

@MainActor
final class AudioNoteRecorder {
    var onAudioLevel: ((Double) -> Void)?

    private let backend: BackendClient
    private var microphoneCapture: MicrophoneCaptureCoordinator?
    private let systemAudioCapture: SystemAudioCaptureCoordinator?
    private var session: AudioRecordingSession?

    /// True when a session exists in any state (recording or
    /// post-stop-failure). Used by orphan-rescue to detect that there
    /// is local data still on disk that wasn't uploaded.
    var hasActiveSession: Bool { session != nil }

    /// Read-only view of the active session for orphan recovery.
    /// Returns nil after a successful stopAndUpload (the session is
    /// torn down) or before any start. Stays valid after a failed
    /// stopAndUpload — that's the whole point.
    var currentSessionSnapshot: AudioRecordingSessionSnapshot? {
        guard let session else { return nil }
        return AudioRecordingSessionSnapshot(
            directory: session.directory,
            tracks: session.tracks,
            title: session.title,
            startedAt: session.startedAt,
            backendRecordingId: session.backendRecordingId,
            backendSlug: session.backendSlug,
            meetingContext: session.meetingContext
        )
    }

    /// Forget the in-memory session pointer without trying to abort
    /// or clean up files on disk. Used after we've successfully
    /// copied the local files into the orphan store — the session
    /// is now persisted somewhere durable, the recorder doesn't
    /// need to keep referencing it. The /var/folders dir stays put;
    /// macOS will purge it eventually. The orphan store is the
    /// authoritative copy from now on.
    func detachSessionAfterOrphanSave() {
        session = nil
        microphoneCapture = nil
    }

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
                microphoneCapture = try await startMicrophoneCapture(
                    primaryURL: url,
                    deviceID: microphoneDeviceID,
                    audioLevelSink: audioLevelSink
                )
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
            // The mic coordinator returns the actual completed local file.
            // In the AEC fallback case this may be either the voice-processed
            // attempt URL or the plain-capture URL.
            if let micURL = try await microphoneCapture?.stop() {
                localFiles[.mic] = micURL
            }
            microphoneCapture = nil
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
        let microphoneCapture = self.microphoneCapture
        self.microphoneCapture = nil
        if session.tracks.contains(.mic) {
            _ = try? await microphoneCapture?.stop()
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

    private func startMicrophoneCapture(
        primaryURL: URL,
        deviceID: String?,
        audioLevelSink: ((Double) -> Void)?
    ) async throws -> MicrophoneCaptureCoordinator {
        // VPIO is disabled by default. Enabling
        // `setVoiceProcessingEnabled(true)` on macOS gives us echo
        // cancellation but also forces the OS audio output through
        // the VoiceProcessing IO unit, which ducks/mutes other apps'
        // playback (Zoom, Meet, music) for the duration of the
        // recording — Ian got bitten by this mid-call. Since we
        // already capture system audio as a separate track, the
        // mix-audio job can do server-side dedup if echo ever shows
        // up. Headphone users (the typical recording-a-call case)
        // get clean mic audio either way because there's no
        // acoustic feedback path.
        let plain = makeMicrophoneCapture(audioLevelSink: audioLevelSink)
        try await plain.startWithTimeout(
            deviceID: deviceID,
            outputURL: primaryURL,
            voiceProcessingEnabled: false
        )
        return plain
    }

    private func makeMicrophoneCapture(
        audioLevelSink: ((Double) -> Void)?
    ) -> MicrophoneCaptureCoordinator {
        let capture = MicrophoneCaptureCoordinator()
        capture.onLevel = { level in
            audioLevelSink?(level)
        }
        return capture
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
