import Foundation
import OSLog

private let log = Logger(subsystem: "cloud.dissonance.loom.desktop", category: "orphan-retry")

/// Re-runs the start → multipart upload → complete sequence for an
/// orphaned audio recording whose original upload failed. Reuses
/// the same BackendClient and MultipartUploadCoordinator the live
/// recording flow uses, just driven from the durable copy of the
/// audio files on disk instead of an in-flight session.
///
/// Why a brand-new recording row instead of resuming the original:
/// the original row has a stale `upload_metadata` (uploadIds tied
/// to multipart sessions on the R2 side that may have expired or
/// been aborted by retention). Easier and more idempotent to abort
/// the old one and POST a fresh /api/recordings/start. The orphan
/// metadata records the original slug for traceability.
@MainActor
final class OrphanRetryCoordinator {
    private let backend: BackendClient

    init(backend: BackendClient) {
        self.backend = backend
    }

    /// Result of a successful retry: the freshly-uploaded recording's
    /// slug and id. Caller marks the orphan as rescued.
    struct Outcome {
        let recordingId: String
        let slug: String
    }

    /// Runs the full retry pipeline. Throws on any step failure;
    /// caller surfaces the error and marks `lastError` on the orphan.
    func retry(_ orphan: OrphanedRecording) async throws -> Outcome {
        log.notice("retry begin: orphan=\(orphan.id.uuidString, privacy: .public) tracks=\(orphan.tracks.count, privacy: .public) bytes=\(orphan.totalBytes(), privacy: .public)")

        // 1. Best-effort abort of the original row. Don't fail the
        //    retry if abort 404s (the row may already be soft-deleted)
        //    or 5xx's — the new recording stands on its own.
        if let originalId = orphan.originalRecordingId {
            do {
                try await backend.abort(recordingId: originalId)
                log.notice("retry: aborted original \(originalId, privacy: .public)")
            } catch {
                log.notice("retry: abort skipped (\(error.localizedDescription, privacy: .public)) — proceeding")
            }
        }

        // 2. Fresh /api/recordings/start. Title carries through so the
        //    note appears with the user's intended title (or the AI-
        //    suggested title later via Generate Notes).
        let trackList = orphan.tracks
            .filter { $0 == .mic || $0 == .systemAudio }
            .map { StartRecordingRequest.Track(kind: $0, mimeType: "audio/mp4") }
        guard !trackList.isEmpty else {
            throw OrphanRetryError.noTracks
        }
        let title = orphan.title ?? "Recovered audio note"
        let startRequest = StartRecordingRequest(
            type: .audio,
            tracks: trackList,
            resolution: "audio-only",
            brandProfileId: nil,
            title: title,
            meetingDetectedApp: nil,
            meetingStartedAtLocal: ISO8601DateFormatter().string(from: orphan.capturedAt),
            attendees: [],
            sourceContextHint: "rescued from local cache after upload failure"
        )
        let started = try await backend.startRecording(startRequest)
        log.notice("retry: started new recording id=\(started.recordingId, privacy: .public) slug=\(started.slug, privacy: .public)")

        // 3. Multipart upload each track's local file.
        let uploader = MultipartUploadCoordinator(backend: backend)
        var completedTracks: [TrackKind: [CompletedPart]] = [:]
        for track in orphan.tracks {
            let url: URL? = (track == .mic) ? orphan.micFileURL() : orphan.systemAudioFileURL()
            guard let fileURL = url else {
                log.error("retry: no local file for track \(track.rawValue, privacy: .public)")
                continue
            }
            let parts = try await uploader.uploadFile(
                url: fileURL,
                recordingId: started.recordingId,
                track: track
            )
            if !parts.isEmpty {
                completedTracks[track] = parts
            }
        }
        guard !completedTracks.isEmpty else {
            throw OrphanRetryError.noUploadedTracks
        }

        // 4. Complete the multipart upload. The server enqueues
        //    mix-audio, transcribe, audio-waveform from here.
        let completeResponse = try await backend.complete(
            recordingId: started.recordingId,
            request: CompleteRecordingRequest(
                tracks: completedTracks,
                durationSeconds: orphan.durationSeconds
            )
        )
        log.notice("retry complete: slug=\(completeResponse.slug, privacy: .public)")
        return Outcome(recordingId: started.recordingId, slug: completeResponse.slug)
    }
}

enum OrphanRetryError: LocalizedError {
    case noTracks
    case noUploadedTracks

    var errorDescription: String? {
        switch self {
        case .noTracks:
            return "Orphaned recording has no tracks to upload."
        case .noUploadedTracks:
            return "No tracks were successfully uploaded; check disk for the original audio files."
        }
    }
}
