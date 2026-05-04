import Foundation

struct AudioRecordingSession: Equatable, Sendable {
    let id: UUID
    let directory: URL
    let startedAt: Date
    let title: String?
    let tracks: Set<TrackKind>
    let meetingContext: MeetingContext?
    var backendRecordingId: String?
    var backendSlug: String?

    init(
        id: UUID = UUID(),
        directory: URL,
        startedAt: Date = Date(),
        title: String?,
        tracks: Set<TrackKind>,
        meetingContext: MeetingContext? = nil,
        backendRecordingId: String? = nil,
        backendSlug: String? = nil
    ) {
        self.id = id
        self.directory = directory
        self.startedAt = startedAt
        self.title = title
        self.tracks = tracks
        self.meetingContext = meetingContext
        self.backendRecordingId = backendRecordingId
        self.backendSlug = backendSlug
    }

    var startedAtISO8601: String {
        ISO8601DateFormatter().string(from: startedAt)
    }

    func localFileURL(for track: TrackKind) -> URL? {
        switch track {
        case .mic where tracks.contains(.mic):
            return directory.appending(path: "mic.m4a")
        case .systemAudio where tracks.contains(.systemAudio):
            return directory.appending(path: "system-audio.m4a")
        default:
            return nil
        }
    }

    var startRequest: StartRecordingRequest {
        StartRecordingRequest(
            type: .audio,
            tracks: tracks.sortedForAudioUpload.map {
                StartRecordingRequest.Track(kind: $0, mimeType: "audio/mp4")
            },
            resolution: "audio-only",
            brandProfileId: nil,
            title: title,
            meetingDetectedApp: meetingContext?.detectedApp,
            meetingStartedAtLocal: startedAtISO8601,
            attendees: [],
            sourceContextHint: meetingContext?.sourceContextHint ?? "manual desktop audio recording"
        )
    }
}

private extension Set where Element == TrackKind {
    var sortedForAudioUpload: [TrackKind] {
        [.mic, .systemAudio].filter { contains($0) }
    }
}
