import XCTest
@testable import LoomDesktopApp

@MainActor
final class OrphanedRecordingStoreTests: XCTestCase {
    func testCapturePersistsTracksAndMetadata() throws {
        // Build a fake captured session with two real files on disk.
        let sourceDir = makeTempDir()
        defer { try? FileManager.default.removeItem(at: sourceDir) }
        let micURL = sourceDir.appending(path: "mic.m4a")
        let sysURL = sourceDir.appending(path: "system-audio.m4a")
        try Data([0x01, 0x02, 0x03]).write(to: micURL)
        try Data([0xAA, 0xBB]).write(to: sysURL)

        let store = makeStore()
        let snapshot = AudioRecordingSessionSnapshot(
            directory: sourceDir,
            tracks: [.mic, .systemAudio],
            title: "Standup notes",
            startedAt: Date(timeIntervalSince1970: 1746540253),
            backendRecordingId: "rec-uuid",
            backendSlug: "abc123XYZ0",
            meetingContext: nil
        )

        let orphan = try store.capture(
            from: snapshot,
            durationSeconds: 4360.5,
            lastError: "Backend was unavailable"
        )

        XCTAssertEqual(orphan.title, "Standup notes")
        XCTAssertEqual(orphan.originalRecordingId, "rec-uuid")
        XCTAssertEqual(orphan.originalSlug, "abc123XYZ0")
        XCTAssertEqual(orphan.durationSeconds, 4360.5)
        XCTAssertEqual(orphan.lastError, "Backend was unavailable")
        XCTAssertEqual(Set(orphan.tracks), Set([.mic, .systemAudio]))
        XCTAssertEqual(orphan.totalBytes(), 5)

        // Files should now exist in the durable storage dir, not the source.
        XCTAssertTrue(FileManager.default.fileExists(atPath: orphan.micFileURL()!.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: orphan.systemAudioFileURL()!.path))
        XCTAssertNotEqual(orphan.storageDirectory, sourceDir)
        // metadata.json should be present and decodable.
        let metaPath = orphan.storageDirectory.appending(path: "metadata.json").path
        XCTAssertTrue(FileManager.default.fileExists(atPath: metaPath))

        XCTAssertEqual(store.orphans.count, 1)
        XCTAssertTrue(store.hasUnrescuedOrphans)
    }

    func testRefreshRoundtripsMetadata() throws {
        let sourceDir = makeTempDir()
        defer { try? FileManager.default.removeItem(at: sourceDir) }
        let micURL = sourceDir.appending(path: "mic.m4a")
        try Data([0x10]).write(to: micURL)

        let store = makeStore()
        let snapshot = AudioRecordingSessionSnapshot(
            directory: sourceDir,
            tracks: [.mic],
            title: nil,
            startedAt: Date(timeIntervalSince1970: 1746540253),
            backendRecordingId: nil,
            backendSlug: nil,
            meetingContext: nil
        )
        let captured = try store.capture(
            from: snapshot,
            durationSeconds: 30,
            lastError: nil
        )

        // Build a *new* store pointing at the same test root — it
        // should rediscover the orphan.
        let store2 = OrphanedRecordingStore(storeRoot: testStoreRoot)
        store2.refresh()
        let found = store2.orphans.first { $0.id == captured.id }
        XCTAssertNotNil(found, "orphan should round-trip through metadata.json")
        XCTAssertEqual(found?.tracks, [.mic])
    }

    func testCapturePersistsLiveTranscriptSnapshot() throws {
        let sourceDir = makeTempDir()
        defer { try? FileManager.default.removeItem(at: sourceDir) }
        try Data([0x10]).write(to: sourceDir.appending(path: "mic.m4a"))

        let store = makeStore()
        let snapshot = AudioRecordingSessionSnapshot(
            directory: sourceDir,
            tracks: [.mic],
            title: "Transcript note",
            startedAt: Date(timeIntervalSince1970: 1746540253),
            backendRecordingId: "rec-uuid",
            backendSlug: "abc123XYZ0",
            meetingContext: nil
        )
        let transcript = LiveTranscriptSnapshot(
            fullText: "Mic: Hello from the rescued transcript",
            language: "en",
            providerRequestId: "request-1",
            words: [
                LiveTranscriptSnapshot.Word(
                    word: "Hello",
                    start: 1,
                    end: 1.4,
                    confidence: 0.97,
                    speaker: 0
                )
            ]
        )

        let orphan = try store.capture(
            from: snapshot,
            durationSeconds: 30,
            lastError: "Upload failed",
            liveTranscriptSnapshot: transcript
        )

        XCTAssertNotNil(orphan.liveTranscriptSnapshotFileURL())
        XCTAssertNotNil(orphan.liveTranscriptTextFileURL())
        let restored = try XCTUnwrap(orphan.loadLiveTranscriptSnapshot())
        XCTAssertEqual(restored.fullText, transcript.fullText)
        XCTAssertEqual(restored.words.first?.word, "Hello")
        XCTAssertEqual(
            try String(contentsOf: try XCTUnwrap(orphan.liveTranscriptTextFileURL())),
            transcript.fullText
        )
    }

    func testMarkRescuedClearsLastErrorAndRecordsSlug() throws {
        let sourceDir = makeTempDir()
        defer { try? FileManager.default.removeItem(at: sourceDir) }
        try Data([0x42]).write(to: sourceDir.appending(path: "mic.m4a"))

        let store = makeStore()
        let snapshot = AudioRecordingSessionSnapshot(
            directory: sourceDir,
            tracks: [.mic],
            title: "Original title",
            startedAt: Date(),
            backendRecordingId: nil,
            backendSlug: nil,
            meetingContext: nil
        )
        let orphan = try store.capture(
            from: snapshot,
            durationSeconds: 60,
            lastError: "Boom"
        )
        try store.markRescued(orphan, rescuedSlug: "newSlug123")

        let updated = try XCTUnwrap(store.orphans.first { $0.id == orphan.id })
        XCTAssertEqual(updated.rescuedSlug, "newSlug123")
        XCTAssertNotNil(updated.rescuedAt)
        XCTAssertNil(updated.lastError)
        XCTAssertFalse(store.hasUnrescuedOrphans)
    }

    func testRecoveryCopyPresentationDistinguishesUploadedFromOnlyCopy() {
        let base = OrphanedRecording(
            id: UUID(),
            storageDirectory: URL(fileURLWithPath: "/tmp/orphan"),
            originalRecordingId: nil,
            originalSlug: nil,
            title: "Important call",
            capturedAt: Date(),
            stoppedAt: Date(),
            durationSeconds: 60,
            tracks: [.mic]
        )

        XCTAssertEqual(base.recoveryStatusLabel, "Needs upload")
        XCTAssertEqual(base.localCopyActionLabel, "Delete only copy")
        XCTAssertTrue(base.localCopyDetail.contains("only copy"))
        XCTAssertTrue(base.discardConfirmationMessage.contains("cannot be undone"))

        var rescued = base
        rescued.rescuedAt = Date()
        rescued.rescuedSlug = "uploadedSlug"

        XCTAssertEqual(rescued.recoveryStatusLabel, "Uploaded")
        XCTAssertEqual(rescued.localCopyActionLabel, "Delete local copy")
        XCTAssertTrue(rescued.localCopyDetail.contains("still on this Mac"))
        XCTAssertTrue(rescued.discardConfirmationMessage.contains("will not be deleted"))
    }

    func testDiscardRemovesFilesAndEntry() throws {
        let sourceDir = makeTempDir()
        defer { try? FileManager.default.removeItem(at: sourceDir) }
        try Data([0x01]).write(to: sourceDir.appending(path: "mic.m4a"))

        let store = makeStore()
        let orphan = try store.capture(
            from: AudioRecordingSessionSnapshot(
                directory: sourceDir,
                tracks: [.mic],
                title: nil,
                startedAt: Date(),
                backendRecordingId: nil,
                backendSlug: nil,
                meetingContext: nil
            ),
            durationSeconds: 1,
            lastError: nil
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: orphan.storageDirectory.path))

        try store.discard(orphan)

        XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.storageDirectory.path))
        XCTAssertFalse(store.orphans.contains { $0.id == orphan.id })
    }

    func testCaptureVideoPersistsCompositeAndRoundTrips() throws {
        let sourceDir = makeTempDir()
        defer { try? FileManager.default.removeItem(at: sourceDir) }
        let compositeURL = sourceDir.appending(path: "recording.mp4")
        try Data([0x00, 0x01, 0x02, 0x03, 0x04]).write(to: compositeURL)

        let store = makeStore()
        let orphan = try store.captureVideo(
            compositeURL: compositeURL,
            startedAt: Date(timeIntervalSince1970: 1751920000),
            durationSeconds: 312.5,
            originalRecordingId: "vid-rec-uuid",
            originalSlug: "vidSlug123",
            lastError: "The request timed out."
        )

        XCTAssertTrue(orphan.isVideo)
        XCTAssertEqual(orphan.tracks, [.composite])
        XCTAssertEqual(orphan.totalBytes(), 5)
        XCTAssertNotNil(orphan.compositeFileURL())
        XCTAssertNil(orphan.micFileURL())

        // Round-trip through a fresh store instance (refresh from disk).
        let reloaded = OrphanedRecordingStore(storeRoot: testStoreRoot)
        let loaded = try XCTUnwrap(reloaded.orphans.first(where: { $0.id == orphan.id }))
        XCTAssertTrue(loaded.isVideo)
        XCTAssertEqual(loaded.originalRecordingId, "vid-rec-uuid")
        XCTAssertEqual(loaded.durationSeconds, 312.5)
        XCTAssertNotNil(loaded.compositeFileURL())
    }

    // MARK: - Helpers

    private var testStoreRoot: URL {
        FileManager.default.temporaryDirectory
            .appending(path: "loomola-orphan-store-tests", directoryHint: .isDirectory)
    }

    /// Returns an isolated store after wiping only the test directory.
    private func makeStore() -> OrphanedRecordingStore {
        try? FileManager.default.removeItem(at: testStoreRoot)
        return OrphanedRecordingStore(storeRoot: testStoreRoot)
    }

    private func makeTempDir() -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appending(path: "orphan-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
