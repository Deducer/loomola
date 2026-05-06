import XCTest
@testable import LoomDesktopApp

/// Locks the DTO → view-model mapping for `RecentRecording`. The
/// init is failable (returns nil for unsupported `kind`s), parses
/// two ISO 8601 variants, and forwards the new folder fields. None
/// of these have run-time tests today, and each has been involved
/// in a regression at least once during this sprint:
///   • durationSeconds was emitted as a JSON string and crashed
///     decode (server fixed in c0232a8).
///   • folderId/folderName were missing from the DTO and the
///     desktop's strict decoder would have rejected the response
///     once the server started emitting them.
///   • createdAt without fractional seconds came back from the
///     `complete` flow in some paths.
final class RecentRecordingTests: XCTestCase {
    func testValidVideoDTODecodes() {
        let r = RecentRecording(dto: video)
        XCTAssertNotNil(r)
        XCTAssertEqual(r?.id, "v1")
        XCTAssertEqual(r?.slug, "video-slug")
        XCTAssertEqual(r?.title, "My Video")
        XCTAssertEqual(r?.kind, .video)
        XCTAssertEqual(r?.durationSeconds, 12.5)
        XCTAssertEqual(r?.thumbnailURL, URL(string: "https://example.com/thumb.jpg"))
        XCTAssertNil(r?.folderId)
        XCTAssertNil(r?.folderName)
    }

    func testValidAudioDTODecodes() {
        let r = RecentRecording(dto: audio)
        XCTAssertNotNil(r)
        XCTAssertEqual(r?.kind, .audio)
        XCTAssertEqual(r?.folderId, "folder-1")
        XCTAssertEqual(r?.folderName, "Vayu Labs")
    }

    func testUnsupportedKindReturnsNil() {
        let dto = RecentRecordingDTO(
            id: "x",
            slug: "s",
            title: "Future kind",
            kind: "screencast",  // not "video" or "audio"
            createdAt: "2026-05-06T14:00:00.123Z",
            durationSeconds: nil,
            thumbnailUrl: nil,
            folderId: nil,
            folderName: nil
        )
        XCTAssertNil(RecentRecording(dto: dto))
    }

    func testCreatedAtWithFractionalSecondsParses() {
        let dto = makeDTO(createdAt: "2026-05-06T14:30:45.250Z")
        let r = RecentRecording(dto: dto)
        XCTAssertNotNil(r)
        // Round-trip: format the parsed date back and check it came
        // from the right wall-clock moment (within 1ms).
        let parsed = r!.createdAt
        let expected = ISO8601DateFormatter().date(from: "2026-05-06T14:30:45Z")!
        XCTAssertEqual(parsed.timeIntervalSince(expected), 0.250, accuracy: 0.01)
    }

    func testCreatedAtWithoutFractionalSecondsParses() {
        let dto = makeDTO(createdAt: "2026-05-06T14:30:45Z")
        let r = RecentRecording(dto: dto)
        XCTAssertNotNil(r)
        let parsed = r!.createdAt
        let expected = ISO8601DateFormatter().date(from: "2026-05-06T14:30:45Z")!
        XCTAssertEqual(parsed.timeIntervalSinceReferenceDate,
                       expected.timeIntervalSinceReferenceDate, accuracy: 0.01)
    }

    func testCreatedAtMalformedFallsBackToNow() {
        // The init's last-resort fallback is `Date()`. It can't
        // throw; we only want to verify it doesn't crash on bad
        // input and produces *some* date close to now.
        let dto = makeDTO(createdAt: "not-a-date")
        let r = RecentRecording(dto: dto)
        XCTAssertNotNil(r)
        XCTAssertLessThan(abs(r!.createdAt.timeIntervalSinceNow), 5)
    }

    func testThumbnailURLIsNilWhenAbsent() {
        let dto = makeDTO(thumbnailUrl: nil)
        XCTAssertNil(RecentRecording(dto: dto)?.thumbnailURL)
    }

    func testWithFolderProducesUpdatedCopy() {
        let original = RecentRecording(dto: audio)!
        let updated = original.with(folderId: "new-folder", folderName: "Granola")
        XCTAssertEqual(updated.folderId, "new-folder")
        XCTAssertEqual(updated.folderName, "Granola")
        // Identity & content otherwise preserved.
        XCTAssertEqual(updated.id, original.id)
        XCTAssertEqual(updated.title, original.title)
        XCTAssertEqual(updated.createdAt, original.createdAt)
    }

    func testWithFolderClearsAssignmentWhenPassedNil() {
        let original = RecentRecording(dto: audio)!
        let cleared = original.with(folderId: nil, folderName: nil)
        XCTAssertNil(cleared.folderId)
        XCTAssertNil(cleared.folderName)
    }

    // MARK: - Helpers

    private var video: RecentRecordingDTO {
        RecentRecordingDTO(
            id: "v1",
            slug: "video-slug",
            title: "My Video",
            kind: "video",
            createdAt: "2026-05-06T14:30:45.250Z",
            durationSeconds: 12.5,
            thumbnailUrl: "https://example.com/thumb.jpg",
            folderId: nil,
            folderName: nil
        )
    }

    private var audio: RecentRecordingDTO {
        RecentRecordingDTO(
            id: "a1",
            slug: "audio-slug",
            title: "Meeting Notes",
            kind: "audio",
            createdAt: "2026-05-06T10:00:00.000Z",
            durationSeconds: 1800,
            thumbnailUrl: nil,
            folderId: "folder-1",
            folderName: "Vayu Labs"
        )
    }

    private func makeDTO(
        kind: String = "audio",
        createdAt: String = "2026-05-06T14:30:45.250Z",
        thumbnailUrl: String? = nil
    ) -> RecentRecordingDTO {
        RecentRecordingDTO(
            id: "x",
            slug: "s",
            title: "T",
            kind: kind,
            createdAt: createdAt,
            durationSeconds: nil,
            thumbnailUrl: thumbnailUrl,
            folderId: nil,
            folderName: nil
        )
    }
}
