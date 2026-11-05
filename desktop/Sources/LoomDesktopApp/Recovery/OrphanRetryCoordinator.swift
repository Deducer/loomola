import AVFoundation
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
///
/// The exception is a segment recorded with Resume after Stop: that
/// note already holds the earlier segment(s), so the rescue goes back
/// through /api/notes/[id]/resume and appends (`retryResumedSegment`).
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

        if orphan.isVideo {
            return try await retryVideo(orphan)
        }
        if let noteId = orphan.resumedNoteId {
            return try await retryResumedSegment(orphan, noteId: noteId)
        }
        return try await retryAsNewNote(orphan)
    }

    /// Resume after Stop rescue: append the segment to the note it was
    /// recorded onto. The note is left exactly as it was if any step
    /// fails (abort restores its previous status), so this is safe to
    /// re-run.
    private func retryResumedSegment(_ orphan: OrphanedRecording, noteId: String) async throws -> Outcome {
        let uploadTracks = usableTracks(for: orphan)
        guard !uploadTracks.isEmpty else { throw OrphanRetryError.noTracks }

        let resumed: ResumeAudioNoteResponse
        do {
            resumed = try await openResume(noteId: noteId, orphan: orphan)
        } catch let error as BackendClientError where error.apiErrorCode == "not_found" {
            // The note was trashed since: nothing to append to. Keep the
            // audio by saving it as its own note rather than failing forever.
            log.notice("resumed-segment retry: note \(noteId, privacy: .public) is gone; saving as a new note")
            return try await retryAsNewNote(orphan)
        }
        log.notice("resumed-segment retry: note=\(noteId, privacy: .public) segment=\(resumed.segmentIndex, privacy: .public)")

        // From here the note is "uploading" under this attempt. If anything
        // fails before /complete, put it back (abort restores its previous
        // status), otherwise the next retry would mistake this attempt for
        // a live recording and refuse to touch it. Abort after a successful
        // /complete is a harmless 400 (no uploads pending).
        do {
            let uploader = MultipartUploadCoordinator(backend: backend)
            var completedTracks: [TrackKind: [CompletedPart]] = [:]
            for track in uploadTracks where resumed.tracks.contains(track) {
                guard let fileURL = (track == .mic) ? orphan.micFileURL() : orphan.systemAudioFileURL() else { continue }
                let parts = try await uploader.uploadFile(
                    url: fileURL,
                    recordingId: resumed.recordingId,
                    track: track
                )
                if !parts.isEmpty {
                    completedTracks[track] = parts
                }
            }
            guard !completedTracks.isEmpty else {
                throw OrphanRetryError.noUploadedTracks
            }

            let durationSeconds = await Self.recoveredDurationSeconds(for: uploadTracks, orphan: orphan)
            let completeResponse = try await backend.complete(
                recordingId: resumed.recordingId,
                request: CompleteRecordingRequest(tracks: completedTracks, durationSeconds: durationSeconds)
            )
            log.notice("resumed-segment retry complete: slug=\(completeResponse.slug, privacy: .public)")
            return Outcome(recordingId: resumed.recordingId, slug: completeResponse.slug)
        } catch {
            try? await backend.abort(recordingId: noteId)
            log.error("resumed-segment retry failed; note restored: \(error.localizedDescription, privacy: .public)")
            throw error
        }
    }

    /// Opens the resume uploads. A 409 `note_busy` whose pending resume
    /// began before this orphan was stopped is the orphan's own failed
    /// attempt (or an older abandoned one): abort it and try once more.
    /// A resume that began later is someone recording onto the note
    /// right now, and must not be touched.
    private func openResume(noteId: String, orphan: OrphanedRecording) async throws -> ResumeAudioNoteResponse {
        do {
            return try await backend.resumeAudioNote(mediaId: noteId, recordedAt: orphan.capturedAt)
        } catch let error as BackendClientError where error.apiErrorCode == "note_busy" {
            guard let decision = Self.staleResumeDecision(errorBody: error.apiErrorBody, orphanStoppedAt: orphan.stoppedAt) else {
                throw OrphanRetryError.noteBusy(status: error.apiErrorBody?["mediaStatus"] as? String)
            }
            switch decision {
            case .abortAndRetry:
                try await backend.abort(recordingId: noteId)
                log.notice("resumed-segment retry: cleared stale resume on \(noteId, privacy: .public)")
                return try await backend.resumeAudioNote(mediaId: noteId, recordedAt: orphan.capturedAt)
            case .liveElsewhere:
                throw OrphanRetryError.noteBusy(status: "recording")
            }
        }
    }

    enum StaleResumeDecision: Equatable {
        case abortAndRetry
        case liveElsewhere
    }

    /// Pure: reads the resume route's 409 body. Nil when the note is busy
    /// for another reason (transcribing, processing) — wait it out.
    static func staleResumeDecision(errorBody: [String: Any]?, orphanStoppedAt: Date) -> StaleResumeDecision? {
        guard let segment = errorBody?["resumeSegment"] as? [String: Any],
              let startedAtRaw = segment["startedAt"] as? String
        else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let startedAt = parser.date(from: startedAtRaw)
            ?? ISO8601DateFormatter().date(from: startedAtRaw)
        guard let startedAt else { return nil }
        return startedAt <= orphanStoppedAt ? .abortAndRetry : .liveElsewhere
    }

    private func retryAsNewNote(_ orphan: OrphanedRecording) async throws -> Outcome {
        let originalNote: NoteBodyResponse?
        let originalRecent: RecentRecordingDTO?
        if let originalId = orphan.originalRecordingId {
            originalNote = try? await backend.getNote(mediaId: originalId)
            let recentResponse = try? await backend.recentRecordings(limit: 50, kind: "audio")
            originalRecent = recentResponse?.items.first(where: { $0.id == originalId })
        } else {
            originalNote = nil
            originalRecent = nil
        }

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
        let uploadTracks = usableTracks(for: orphan)
        let trackList = uploadTracks
            .filter { $0 == .mic || $0 == .systemAudio }
            .map { StartRecordingRequest.Track(kind: $0, mimeType: "audio/mp4") }
        guard !trackList.isEmpty else {
            throw OrphanRetryError.noTracks
        }
        let title = orphan.title ?? originalRecent?.title ?? "Recovered audio note"
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
        for track in uploadTracks {
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
        let durationSeconds = await Self.recoveredDurationSeconds(
            for: uploadTracks,
            orphan: orphan
        )
        let completeResponse = try await backend.complete(
            recordingId: started.recordingId,
            request: CompleteRecordingRequest(
                tracks: completedTracks,
                durationSeconds: durationSeconds
            )
        )
        log.notice("retry complete: slug=\(completeResponse.slug, privacy: .public)")

        if let body = originalNote?.body, !body.isEmpty {
            try? await backend.putNoteBody(mediaId: started.recordingId, body: body)
        }
        if let templateId = originalNote?.templateId, !templateId.isEmpty {
            try? await backend.setNoteTemplate(mediaId: started.recordingId, templateId: templateId)
        }
        if let folderId = originalRecent?.folderId {
            try? await backend.assignRecordingToFolder(recordingId: started.recordingId, folderId: folderId)
        }
        if let liveTranscript = orphan.loadLiveTranscriptSnapshot(),
           !liveTranscript.fullText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            do {
                try await backend.persistLiveTranscript(
                    mediaId: started.recordingId,
                    snapshot: liveTranscript
                )
                log.notice("retry: restored live transcript for \(started.recordingId, privacy: .public)")
            } catch {
                log.error("retry: live transcript restore failed: \(error.localizedDescription, privacy: .public)")
            }
        }

        return Outcome(recordingId: started.recordingId, slug: completeResponse.slug)
    }

    /// Video retry: abort the stale original row, start a fresh video
    /// recording with one composite track, multipart-upload the local
    /// MP4, and complete — the server enqueues transcribe, transcode,
    /// thumbnail, and preview-sprite from there, same as a live upload.
    private func retryVideo(_ orphan: OrphanedRecording) async throws -> Outcome {
        guard let compositeURL = orphan.compositeFileURL() else {
            throw OrphanRetryError.noTracks
        }

        if let originalId = orphan.originalRecordingId {
            do {
                try await backend.abort(recordingId: originalId)
                log.notice("video retry: aborted original \(originalId, privacy: .public)")
            } catch {
                log.notice("video retry: abort skipped (\(error.localizedDescription, privacy: .public)) — proceeding")
            }
        }

        let started = try await backend.startRecording(
            StartRecordingRequest(
                tracks: [.init(kind: .composite, mimeType: "video/mp4")],
                resolution: "screen-native",
                brandProfileId: nil,
                title: orphan.title,
                sourceContextHint: "rescued from local cache after upload failure"
            )
        )
        log.notice("video retry: started new recording id=\(started.recordingId, privacy: .public) slug=\(started.slug, privacy: .public)")

        let uploader = MultipartUploadCoordinator(backend: backend)
        let parts = try await uploader.uploadFile(
            url: compositeURL,
            recordingId: started.recordingId,
            track: .composite
        )
        guard !parts.isEmpty else {
            throw OrphanRetryError.noUploadedTracks
        }

        let durationSeconds = await Self.recoveredDurationSeconds(
            for: [.composite],
            orphan: orphan
        )
        let completeResponse = try await backend.complete(
            recordingId: started.recordingId,
            request: CompleteRecordingRequest(
                tracks: [.composite: parts],
                durationSeconds: durationSeconds
            )
        )
        log.notice("video retry complete: slug=\(completeResponse.slug, privacy: .public)")
        return Outcome(recordingId: started.recordingId, slug: completeResponse.slug)
    }

    private func usableTracks(for orphan: OrphanedRecording) -> [TrackKind] {
        orphan.tracks.filter { track in
            let url = (track == .mic) ? orphan.micFileURL() : orphan.systemAudioFileURL()
            guard let url,
                  let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                  let size = attrs[.size] as? NSNumber
            else { return false }

            if size.int64Value < 4096 {
                log.notice("retry: skipping tiny \(track.rawValue, privacy: .public) file (\(size.int64Value, privacy: .public) bytes)")
                return false
            }
            return true
        }
    }

    private static func recoveredDurationSeconds(
        for tracks: [TrackKind],
        orphan: OrphanedRecording
    ) async -> Double {
        var durations: [Double] = []
        for track in tracks {
            let url: URL?
            switch track {
            case .mic: url = orphan.micFileURL()
            case .composite: url = orphan.compositeFileURL()
            default: url = orphan.systemAudioFileURL()
            }
            guard let url else { continue }
            let asset = AVURLAsset(url: url)
            guard let duration = try? await asset.load(.duration) else { continue }
            let seconds = CMTimeGetSeconds(duration)
            if seconds.isFinite, seconds > 0 {
                durations.append(seconds)
            }
        }
        return durations.max() ?? orphan.durationSeconds
    }
}

enum OrphanRetryError: LocalizedError {
    case noTracks
    case noUploadedTracks
    case noteBusy(status: String?)

    var errorDescription: String? {
        switch self {
        case .noTracks:
            return "Orphaned recording has no tracks to upload."
        case .noUploadedTracks:
            return "No tracks were successfully uploaded; check disk for the original audio files."
        case .noteBusy(let status):
            if status == "recording" {
                return "The note is being recorded onto right now. Retry after that recording stops."
            }
            return "The note is still \(status ?? "busy"). Retry once it finishes."
        }
    }
}
