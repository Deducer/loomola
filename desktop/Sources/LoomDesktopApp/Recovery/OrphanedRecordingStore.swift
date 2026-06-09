import Foundation
import OSLog

private let log = Logger(subsystem: "cloud.dissonance.loom.desktop", category: "orphan-store")

/// One audio recording whose `stopAndUpload` failed and whose local
/// audio files have been preserved for later retry. The store keeps
/// these in `~/Library/Application Support/LoomDesktop/orphaned-
/// recordings/<id>/` with mic.m4a + system-audio.m4a alongside a
/// `metadata.json`. Lives across app launches (the user might quit
/// before retrying).
struct OrphanedRecording: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    let storageDirectory: URL
    let originalRecordingId: String?
    let originalSlug: String?
    let title: String?
    let capturedAt: Date
    let stoppedAt: Date
    let durationSeconds: Double
    let tracks: [TrackKind]
    var rescuedAt: Date?
    var rescuedSlug: String?
    var lastError: String?

    enum CodingKeys: String, CodingKey {
        case id, originalRecordingId, originalSlug, title
        case capturedAt, stoppedAt, durationSeconds, tracks
        case rescuedAt, rescuedSlug, lastError
        // storageDirectory is recomputed on load — don't persist it,
        // since the home directory path could change (rare) and the
        // file moves with the metadata.json regardless.
    }

    init(
        id: UUID,
        storageDirectory: URL,
        originalRecordingId: String?,
        originalSlug: String?,
        title: String?,
        capturedAt: Date,
        stoppedAt: Date,
        durationSeconds: Double,
        tracks: [TrackKind],
        rescuedAt: Date? = nil,
        rescuedSlug: String? = nil,
        lastError: String? = nil
    ) {
        self.id = id
        self.storageDirectory = storageDirectory
        self.originalRecordingId = originalRecordingId
        self.originalSlug = originalSlug
        self.title = title
        self.capturedAt = capturedAt
        self.stoppedAt = stoppedAt
        self.durationSeconds = durationSeconds
        self.tracks = tracks
        self.rescuedAt = rescuedAt
        self.rescuedSlug = rescuedSlug
        self.lastError = lastError
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        originalRecordingId = try c.decodeIfPresent(String.self, forKey: .originalRecordingId)
        originalSlug = try c.decodeIfPresent(String.self, forKey: .originalSlug)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        capturedAt = try c.decode(Date.self, forKey: .capturedAt)
        stoppedAt = try c.decode(Date.self, forKey: .stoppedAt)
        durationSeconds = try c.decode(Double.self, forKey: .durationSeconds)
        tracks = try c.decode([TrackKind].self, forKey: .tracks)
        rescuedAt = try c.decodeIfPresent(Date.self, forKey: .rescuedAt)
        rescuedSlug = try c.decodeIfPresent(String.self, forKey: .rescuedSlug)
        lastError = try c.decodeIfPresent(String.self, forKey: .lastError)
        // Will be set by the store after decode based on filesystem path.
        storageDirectory = URL(fileURLWithPath: "/")
    }

    func micFileURL() -> URL? {
        let url = storageDirectory.appending(path: "mic.m4a")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func systemAudioFileURL() -> URL? {
        let url = storageDirectory.appending(path: "system-audio.m4a")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func liveTranscriptSnapshotFileURL() -> URL? {
        let url = storageDirectory.appending(path: "live-transcript.json")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func liveTranscriptTextFileURL() -> URL? {
        let url = storageDirectory.appending(path: "live-transcript.txt")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func loadLiveTranscriptSnapshot() -> LiveTranscriptSnapshot? {
        guard let url = liveTranscriptSnapshotFileURL(),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(LiveTranscriptSnapshot.self, from: data)
    }

    /// Total bytes on disk for this orphan's track files. Used by the
    /// recovery UI to show the user how much is at stake.
    func totalBytes() -> Int64 {
        var total: Int64 = 0
        for track in tracks {
            let url = storageDirectory.appending(path: track == .mic ? "mic.m4a" : "system-audio.m4a")
            if let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
               let size = attrs[.size] as? NSNumber {
                total += size.int64Value
            }
        }
        return total
    }

    /// Replace the storageDirectory with the path from disk; metadata
    /// JSON doesn't persist it because relocating the orphan dir
    /// (e.g., user moves Application Support) shouldn't break recovery.
    func withStorageDirectory(_ url: URL) -> OrphanedRecording {
        var copy = self
        copy = OrphanedRecording(
            id: copy.id,
            storageDirectory: url,
            originalRecordingId: copy.originalRecordingId,
            originalSlug: copy.originalSlug,
            title: copy.title,
            capturedAt: copy.capturedAt,
            stoppedAt: copy.stoppedAt,
            durationSeconds: copy.durationSeconds,
            tracks: copy.tracks,
            rescuedAt: copy.rescuedAt,
            rescuedSlug: copy.rescuedSlug,
            lastError: copy.lastError
        )
        return copy
    }
}

/// Disk-backed store of orphaned recordings. ObservableObject so a
/// SwiftUI view in the settings sheet can react to changes.
@MainActor
final class OrphanedRecordingStore: ObservableObject {
    static let shared = OrphanedRecordingStore()

    @Published private(set) var orphans: [OrphanedRecording] = []

    private let storeRoot: URL
    private let fileManager: FileManager

    init(fileManager: FileManager = .default, storeRoot: URL? = nil) {
        self.fileManager = fileManager
        if let storeRoot {
            self.storeRoot = storeRoot
        } else {
            // Resolve ~/Library/Application Support/LoomDesktop/
            // orphaned-recordings — same Application Support directory the
            // file-based auth session store uses (Stage 7 default), so all
            // app-state lives in one place.
            let appSupport = (try? fileManager.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )) ?? URL(fileURLWithPath: NSHomeDirectory()).appending(path: "Library/Application Support")
            self.storeRoot = appSupport
                .appending(path: "LoomDesktop")
                .appending(path: "orphaned-recordings")
        }

        try? fileManager.createDirectory(
            at: self.storeRoot,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        refresh()
    }

    /// Re-scan the orphans directory. Cheap (a single readdir + N
    /// JSON decodes; one per failed recording, which is unusual).
    func refresh() {
        guard let entries = try? fileManager.contentsOfDirectory(
            at: storeRoot, includingPropertiesForKeys: nil
        ) else {
            orphans = []
            return
        }
        var loaded: [OrphanedRecording] = []
        for entry in entries {
            let metaURL = entry.appending(path: "metadata.json")
            guard fileManager.fileExists(atPath: metaURL.path),
                  let data = try? Data(contentsOf: metaURL)
            else { continue }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            guard let raw = try? decoder.decode(OrphanedRecording.self, from: data) else {
                log.error("orphan store: failed to decode \(metaURL.path, privacy: .public)")
                continue
            }
            loaded.append(raw.withStorageDirectory(entry))
        }
        loaded.sort { $0.capturedAt > $1.capturedAt }
        orphans = loaded
        log.notice("orphan store: refresh → \(loaded.count, privacy: .public) orphan(s)")
    }

    /// True when at least one orphan is present and hasn't been
    /// rescued yet. The home view uses this to decide whether to
    /// surface a recovery banner.
    var hasUnrescuedOrphans: Bool {
        orphans.contains { $0.rescuedAt == nil }
    }

    /// Copy the local audio files from an in-flight session into the
    /// durable store. Called from RecorderViewModel's stopAndUpload
    /// catch handler after an upload failure. Throws if the source
    /// files are missing or the copy fails — in that case the caller
    /// should at least surface the original error to the user.
    @discardableResult
    func capture(
        from snapshot: AudioRecordingSessionSnapshot,
        durationSeconds: Double,
        lastError: String?,
        liveTranscriptSnapshot: LiveTranscriptSnapshot? = nil
    ) throws -> OrphanedRecording {
        let id = UUID()
        let timestamp = ISO8601DateFormatter().string(from: snapshot.startedAt)
            .replacingOccurrences(of: ":", with: "-")
        let slugComponent = snapshot.backendSlug ?? id.uuidString.prefix(8).lowercased()
        let folderName = "\(timestamp)-\(slugComponent)"
        let dir = storeRoot.appending(path: folderName)
        try fileManager.createDirectory(
            at: dir,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )

        for track in snapshot.tracks {
            guard let src = snapshot.localFileURL(for: track),
                  fileManager.fileExists(atPath: src.path)
            else {
                log.error("orphan capture: missing source file for \(track.rawValue, privacy: .public)")
                continue
            }
            let dst = dir.appending(path: track == .mic ? "mic.m4a" : "system-audio.m4a")
            try fileManager.copyItem(at: src, to: dst)
        }

        if let liveTranscriptSnapshot,
           !liveTranscriptSnapshot.fullText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let transcriptData = try JSONEncoder().encode(liveTranscriptSnapshot)
            try transcriptData.write(
                to: dir.appending(path: "live-transcript.json"),
                options: [.atomic]
            )
            try liveTranscriptSnapshot.fullText.write(
                to: dir.appending(path: "live-transcript.txt"),
                atomically: true,
                encoding: .utf8
            )
        }

        let orphan = OrphanedRecording(
            id: id,
            storageDirectory: dir,
            originalRecordingId: snapshot.backendRecordingId,
            originalSlug: snapshot.backendSlug,
            title: snapshot.title,
            capturedAt: snapshot.startedAt,
            stoppedAt: Date(),
            durationSeconds: durationSeconds,
            tracks: Array(snapshot.tracks),
            lastError: lastError
        )
        try writeMetadata(orphan)
        log.notice("orphan captured: id=\(id.uuidString, privacy: .public) dir=\(dir.path, privacy: .public) bytes=\(orphan.totalBytes(), privacy: .public)")
        refresh()
        return orphan
    }

    /// Mark a previously-orphaned recording as rescued. Doesn't
    /// delete the local files — the user should verify the cloud
    /// version first, then click "Discard" if happy.
    func markRescued(_ orphan: OrphanedRecording, rescuedSlug: String) throws {
        var updated = orphan
        updated.rescuedAt = Date()
        updated.rescuedSlug = rescuedSlug
        updated.lastError = nil
        try writeMetadata(updated)
        refresh()
    }

    /// Update the lastError field after a failed retry attempt, so
    /// the user can see why their last try didn't work.
    func updateError(_ orphan: OrphanedRecording, error: String?) throws {
        var updated = orphan
        updated.lastError = error
        try writeMetadata(updated)
        refresh()
    }

    /// Remove the orphan and its local files. The caller is expected
    /// to have verified the cloud-side rescue first (or to be okay
    /// with permanent loss).
    func discard(_ orphan: OrphanedRecording) throws {
        try fileManager.removeItem(at: orphan.storageDirectory)
        log.notice("orphan discarded: id=\(orphan.id.uuidString, privacy: .public)")
        refresh()
    }

    private func writeMetadata(_ orphan: OrphanedRecording) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(orphan)
        let metaURL = orphan.storageDirectory.appending(path: "metadata.json")
        try data.write(to: metaURL, options: [.atomic])
    }
}
