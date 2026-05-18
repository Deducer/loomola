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
