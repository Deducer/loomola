import XCTest
@testable import LoomDesktopApp

final class BackendClientModelsTests: XCTestCase {
    func testStartRecordingResponseDecodesUploadsByTrackKind() throws {
        let json = """
        {
          "recordingId": "rec_123",
          "slug": "abc123",
          "uploads": {
            "composite": { "key": "abc123/composite.mp4", "uploadId": "u1" },
            "system-audio": { "key": "abc123/raw/system-audio.m4a", "uploadId": "u2" }
          }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(StartRecordingResponse.self, from: json)

        XCTAssertEqual(response.recordingId, "rec_123")
        XCTAssertEqual(response.uploads[.composite]?.key, "abc123/composite.mp4")
        XCTAssertEqual(response.uploads[.systemAudio]?.uploadId, "u2")
    }

    func testCompletedPartUsesBackendFieldNames() throws {
        let part = CompletedPart(partNumber: 2, eTag: "\"etag\"")
        let data = try JSONEncoder().encode(part)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["PartNumber"] as? Int, 2)
        XCTAssertEqual(object?["ETag"] as? String, "\"etag\"")
    }

    func testAudioStartRequestUsesGranolaShape() throws {
        let request = StartRecordingRequest(
            type: .audio,
            tracks: [
                .init(kind: .mic, mimeType: "audio/mp4"),
                .init(kind: .systemAudio, mimeType: "audio/mp4")
            ],
            resolution: "audio-only",
            brandProfileId: nil,
            title: "Q2 review",
            meetingDetectedApp: "meet",
            meetingStartedAtLocal: "2026-05-01T05:40:00Z",
            attendees: ["person-1"],
            sourceContextHint: "Google Meet"
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let tracks = try XCTUnwrap(object["tracks"] as? [[String: Any]])

        XCTAssertEqual(object["type"] as? String, "audio")
        XCTAssertEqual(object["title"] as? String, "Q2 review")
        XCTAssertEqual(object["meetingDetectedApp"] as? String, "meet")
        XCTAssertEqual(object["meetingStartedAtLocal"] as? String, "2026-05-01T05:40:00Z")
        XCTAssertEqual(object["attendees"] as? [String], ["person-1"])
        XCTAssertEqual(object["sourceContextHint"] as? String, "Google Meet")
        XCTAssertEqual(tracks.map { $0["kind"] as? String }, ["mic", "system-audio"])
        XCTAssertEqual(tracks.map { $0["mimeType"] as? String }, ["audio/mp4", "audio/mp4"])
    }
}
