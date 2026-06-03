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

    func testCompleteRecordingRequestUsesTrackNamesAsObjectKeys() throws {
        let request = CompleteRecordingRequest(
            tracks: [
                .mic: [CompletedPart(partNumber: 1, eTag: "\"mic\"")],
                .systemAudio: [CompletedPart(partNumber: 1, eTag: "\"system\"")]
            ],
            durationSeconds: 12
        )
        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let tracks = try XCTUnwrap(object["tracks"] as? [String: Any])

        XCTAssertNotNil(tracks["mic"])
        XCTAssertNotNil(tracks["system-audio"])
        XCTAssertNil(tracks["0"])
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

    func testRecentRecordingDecodesAttendees() throws {
        let json = """
        {
          "id": "note-1",
          "slug": "abc123",
          "title": "Weekly sync",
          "kind": "audio",
          "createdAt": "2026-05-28T17:00:00.000Z",
          "durationSeconds": 300,
          "status": "ready",
          "transcriptReady": true,
          "thumbnailUrl": null,
          "folderId": null,
          "folderName": null,
          "attendees": [
            { "id": "person-1", "name": "Javier", "email": "javier@example.com" }
          ]
        }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(RecentRecordingDTO.self, from: json)
        let recording = try XCTUnwrap(RecentRecording(dto: dto))

        XCTAssertEqual(recording.attendees.first?.id, "person-1")
        XCTAssertEqual(recording.attendees.first?.name, "Javier")
    }

    func testAssignAttendeesRequestUsesPersonIds() throws {
        let request = AssignAttendeesRequest(personIds: ["person-1", "person-2"])
        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["personIds"] as? [String], ["person-1", "person-2"])
    }

    func testPersonDTODecodesPeopleEndpointShape() throws {
        let json = """
        {
          "id": "person-1",
          "displayName": "Ian Cross",
          "email": "ian@example.com",
          "isSelf": true
        }
        """.data(using: .utf8)!

        let person = try JSONDecoder().decode(PersonDTO.self, from: json)

        XCTAssertEqual(person.displayName, "Ian Cross")
        XCTAssertTrue(person.isSelf)
    }

    func testNoteTranscriptResponseDecodesParagraphsAndWordCount() throws {
        let json = """
        {
          "fullText": "Hello world from Loomola",
          "language": "en",
          "provider": "deepgram",
          "paragraphs": [
            {
              "speaker": "Speaker 1",
              "startSec": 0.12,
              "endSec": 1.44,
              "text": "Hello world"
            }
          ]
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(NoteTranscriptResponse.self, from: json)

        XCTAssertEqual(response.fullText, "Hello world from Loomola")
        XCTAssertEqual(response.wordCount, 4)
        XCTAssertEqual(response.paragraphs.first?.speaker, "Speaker 1")
        XCTAssertEqual(response.paragraphs.first?.startSec, 0.12)
        XCTAssertEqual(response.paragraphs.first?.text, "Hello world")
    }

    func testAttachmentUploadFailureMessageExplainsLikelyAction() throws {
        let unsupportedBody = #"{"error":"unsupported_image"}"#.data(using: .utf8)!
        let unsupported = BackendClientError.badStatus(
            statusCode: 400,
            path: "/api/recordings/note-1/attachments",
            body: unsupportedBody
        )
        let expiredAuth = BackendClientError.badStatus(
            statusCode: 401,
            path: "/api/recordings/note-1/attachments",
            body: Data()
        )
        let tooLarge = BackendClientError.badStatus(
            statusCode: 413,
            path: "/api/recordings/note-1/attachments",
            body: Data()
        )

        XCTAssertEqual(
            BackendClient.attachmentUploadFailureMessage(unsupported, filename: "shot.tiff"),
            "Couldn't attach shot.tiff: use PNG, JPEG, WebP, or GIF."
        )
        XCTAssertEqual(
            BackendClient.attachmentUploadFailureMessage(expiredAuth, filename: "shot.png"),
            "Couldn't attach shot.png: sign in again."
        )
        XCTAssertEqual(
            BackendClient.attachmentUploadFailureMessage(tooLarge, filename: "shot.png"),
            "Couldn't attach shot.png: image is over 12 MB."
        )
    }
}
