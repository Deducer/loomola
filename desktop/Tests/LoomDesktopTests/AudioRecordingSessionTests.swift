import XCTest
@testable import LoomDesktopApp

final class AudioRecordingSessionTests: XCTestCase {
    func testAudioSessionBuildsLocalTrackURLs() {
        let session = AudioRecordingSession(
            directory: URL(fileURLWithPath: "/tmp/session"),
            title: "Demo",
            tracks: [.mic, .systemAudio]
        )

        XCTAssertEqual(session.localFileURL(for: .mic)?.lastPathComponent, "mic.m4a")
        XCTAssertEqual(session.localFileURL(for: .systemAudio)?.lastPathComponent, "system-audio.m4a")
        XCTAssertNil(session.localFileURL(for: .composite))
    }

    func testAudioSessionBuildsStartRequest() throws {
        let startedAt = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-05-01T05:45:00Z"))
        let session = AudioRecordingSession(
            directory: URL(fileURLWithPath: "/tmp/session"),
            startedAt: startedAt,
            title: "Demo",
            tracks: [.systemAudio, .mic]
        )

        let data = try JSONEncoder().encode(session.startRequest)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let tracks = try XCTUnwrap(object["tracks"] as? [[String: Any]])

        XCTAssertEqual(object["type"] as? String, "audio")
        XCTAssertEqual(object["title"] as? String, "Demo")
        XCTAssertEqual(object["meetingStartedAtLocal"] as? String, "2026-05-01T05:45:00Z")
        XCTAssertEqual(tracks.map { $0["kind"] as? String }, ["mic", "system-audio"])
    }

    func testAudioSessionIncludesMeetingContext() throws {
        let session = AudioRecordingSession(
            directory: URL(fileURLWithPath: "/tmp/session"),
            title: "Demo",
            tracks: [.mic],
            meetingContext: MeetingContext(
                detectedApp: "google-meet",
                sourceContextHint: "Chrome: meet.google.com",
                suggestedTitle: "Weekly Sync",
                joinURL: URL(string: "https://meet.google.com/abc-defg-hij"),
                bundleIdentifier: "com.google.Chrome"
            )
        )

        let data = try JSONEncoder().encode(session.startRequest)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["meetingDetectedApp"] as? String, "google-meet")
        XCTAssertEqual(object["sourceContextHint"] as? String, "Chrome: meet.google.com")
    }
}
