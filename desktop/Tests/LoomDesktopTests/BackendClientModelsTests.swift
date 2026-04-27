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
}
