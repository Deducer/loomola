import Foundation
import OSLog

private let log = Logger(subsystem: "cloud.dissonance.loom.desktop", category: "backend")

actor BackendClient {
    private let baseURL: URL
    private let accessTokenProvider: @Sendable () async throws -> String
    private let session: URLSession

    init(
        baseURL: URL = URL(string: "https://loom.dissonance.cloud")!,
        session: URLSession = .shared,
        accessTokenProvider: @escaping @Sendable () async throws -> String
    ) {
        self.baseURL = baseURL
        self.session = session
        self.accessTokenProvider = accessTokenProvider
    }

    func startRecording(_ request: StartRecordingRequest) async throws -> StartRecordingResponse {
        try await post(path: "/api/recordings/start", body: request)
    }

    func partURL(recordingId: String, request: PartURLRequest) async throws -> PartURLResponse {
        try await post(path: "/api/recordings/\(recordingId)/part-url", body: request)
    }

    func complete(recordingId: String, request: CompleteRecordingRequest) async throws -> CompleteRecordingResponse {
        try await post(path: "/api/recordings/\(recordingId)/complete", body: request)
    }

    func abort(recordingId: String) async throws {
        let _: EmptyResponse = try await post(path: "/api/recordings/\(recordingId)/abort", body: EmptyRequest())
    }

    func pendingObsidianNotes() async throws -> PendingObsidianNotesResponse {
        try await get(path: "/api/notes/obsidian-pending")
    }

    func noteMarkdownExport(mediaId: String) async throws -> String {
        let data = try await getData(path: "/api/notes/\(mediaId)/export.md")
        guard let markdown = String(data: data, encoding: .utf8) else {
            throw BackendClientError.invalidTextResponse(path: "/api/notes/\(mediaId)/export.md")
        }
        return markdown
    }

    func recentRecordings(limit: Int = 4) async throws -> RecentRecordingsResponse {
        try await get(path: "/api/recordings/recent?limit=\(limit)")
    }

    func listFolders() async throws -> ListFoldersResponse {
        try await get(path: "/api/folders")
    }

    func assignRecordingToFolder(recordingId: String, folderId: String?) async throws {
        let _: EmptyResponse = try await jsonRequest(
            method: "PATCH",
            path: "/api/recordings/\(recordingId)/folder",
            body: AssignFolderRequest(folderId: folderId)
        )
    }

    /// Persist the user's live-typed notes body for an audio
    /// recording. Called from the desktop's NotesSidePanel via a
    /// debounced autosave pipeline. Body is plain markdown; the
    /// server upserts the notes row keyed by media_object id.
    func putNoteBody(mediaId: String, body: String) async throws {
        let _: EmptyResponse = try await put(
            path: "/api/notes/\(mediaId)",
            body: NoteBodyRequest(body: body)
        )
    }

    func markObsidianSynced(mediaId: String, filePath: String) async throws {
        let _: EmptyResponse = try await post(
            path: "/api/notes/\(mediaId)/obsidian-synced",
            body: ObsidianSyncedRequest(filePath: filePath)
        )
    }

    private func makeURL(path: String) -> URL {
        BackendURLBuilder.makeURL(path: path, baseURL: baseURL)
    }

    private func get<ResponseBody: Decodable>(path: String) async throws -> ResponseBody {
        let data = try await getData(path: path)
        do {
            return try JSONDecoder().decode(ResponseBody.self, from: data)
        } catch {
            throw BackendClientError.decodingFailed(path: path, body: data, underlyingError: error)
        }
    }

    private func getData(path: String) async throws -> Data {
        let token = try await accessTokenProvider()
        let url = makeURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        log.notice("GET \(url.absoluteString, privacy: .public) (token \(token.prefix(8), privacy: .public)…)")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            log.error("GET \(path, privacy: .public) — non-HTTP response")
            throw BackendClientError.nonHTTPResponse(path: path)
        }
        log.notice("GET \(url.absoluteString, privacy: .public) → \(http.statusCode, privacy: .public) (\(data.count, privacy: .public) bytes)")
        guard (200..<300).contains(http.statusCode) else {
            let bodyPreview = String(data: data.prefix(400), encoding: .utf8) ?? "<binary>"
            log.error("GET \(path, privacy: .public) → \(http.statusCode, privacy: .public) body=\(bodyPreview, privacy: .public)")
            throw BackendClientError.badStatus(statusCode: http.statusCode, path: path, body: data)
        }
        return data
    }

    private func put<RequestBody: Encodable, ResponseBody: Decodable>(
        path: String,
        body: RequestBody
    ) async throws -> ResponseBody {
        try await jsonRequest(method: "PUT", path: path, body: body)
    }

    private func post<RequestBody: Encodable, ResponseBody: Decodable>(
        path: String,
        body: RequestBody
    ) async throws -> ResponseBody {
        try await jsonRequest(method: "POST", path: path, body: body)
    }

    private func jsonRequest<RequestBody: Encodable, ResponseBody: Decodable>(
        method: String,
        path: String,
        body: RequestBody
    ) async throws -> ResponseBody {
        let token = try await accessTokenProvider()
        var request = URLRequest(url: makeURL(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BackendClientError.nonHTTPResponse(path: path)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw BackendClientError.badStatus(statusCode: http.statusCode, path: path, body: data)
        }
        if ResponseBody.self == EmptyResponse.self {
            return EmptyResponse() as! ResponseBody
        }
        do {
            return try JSONDecoder().decode(ResponseBody.self, from: data)
        } catch {
            throw BackendClientError.decodingFailed(path: path, body: data, underlyingError: error)
        }
    }
}

struct StartRecordingRequest: Encodable, Sendable {
    struct Track: Encodable, Sendable {
        let kind: TrackKind
        let mimeType: String
    }

    let type: MediaObjectType?
    let tracks: [Track]
    let resolution: String
    let brandProfileId: String?
    let title: String?
    let meetingDetectedApp: String?
    let meetingStartedAtLocal: String?
    let attendees: [String]?
    let sourceContextHint: String?
    let client = "macos"

    init(
        type: MediaObjectType? = nil,
        tracks: [Track],
        resolution: String,
        brandProfileId: String?,
        title: String? = nil,
        meetingDetectedApp: String? = nil,
        meetingStartedAtLocal: String? = nil,
        attendees: [String]? = nil,
        sourceContextHint: String? = nil
    ) {
        self.type = type
        self.tracks = tracks
        self.resolution = resolution
        self.brandProfileId = brandProfileId
        self.title = title
        self.meetingDetectedApp = meetingDetectedApp
        self.meetingStartedAtLocal = meetingStartedAtLocal
        self.attendees = attendees
        self.sourceContextHint = sourceContextHint
    }
}

struct StartRecordingResponse: Decodable, Equatable, Sendable {
    struct Upload: Decodable, Equatable, Sendable {
        let key: String
        let uploadId: String
    }

    let recordingId: String
    let slug: String
    let uploads: [TrackKind: Upload]

    private enum CodingKeys: String, CodingKey {
        case recordingId
        case slug
        case uploads
    }

    init(recordingId: String, slug: String, uploads: [TrackKind: Upload]) {
        self.recordingId = recordingId
        self.slug = slug
        self.uploads = uploads
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        recordingId = try container.decode(String.self, forKey: .recordingId)
        slug = try container.decode(String.self, forKey: .slug)
        let keyedUploads = try container.decode([String: Upload].self, forKey: .uploads)
        uploads = Dictionary(
            uniqueKeysWithValues: keyedUploads.compactMap { key, upload in
                guard let kind = TrackKind(rawValue: key) else { return nil }
                return (kind, upload)
            }
        )
    }
}

struct PartURLRequest: Encodable, Sendable {
    let track: TrackKind
    let partNumber: Int
}

struct PartURLResponse: Decodable, Equatable, Sendable {
    let url: URL
    let partNumber: Int
}

struct CompleteRecordingRequest: Encodable, Sendable {
    let tracks: [TrackKind: [CompletedPart]]
    let durationSeconds: Double

    enum CodingKeys: String, CodingKey {
        case tracks
        case durationSeconds
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        let stringTracks = Dictionary(
            uniqueKeysWithValues: tracks.map { track, parts in
                (track.rawValue, parts)
            }
        )
        try container.encode(stringTracks, forKey: .tracks)
        try container.encode(durationSeconds, forKey: .durationSeconds)
    }
}

struct CompleteRecordingResponse: Decodable, Equatable, Sendable {
    let slug: String
}

struct PendingObsidianNotesResponse: Decodable, Equatable, Sendable {
    let notes: [PendingObsidianNote]
}

struct PendingObsidianNote: Decodable, Equatable, Sendable {
    let mediaId: String
    let slug: String
    let title: String
    let path: String
    let filename: String
    let exportUrl: String
}

/// Builds request URLs from a base + a path that may include a
/// query string. Lifted out of BackendClient so unit tests can
/// hit it without going through actor isolation.
///
/// Why not `baseURL.appending(path: path)` directly: that helper
/// percent-encodes `?`, turning `/foo?x=1` into `/foo%3Fx=1` (the
/// server then routes to `/foo` with no query, or 404s on the
/// literal `%3F` path). `URL(string:relativeTo:)` parses path +
/// query the way HTTP expects.
enum BackendURLBuilder {
    static func makeURL(path: String, baseURL: URL) -> URL {
        URL(string: path, relativeTo: baseURL)?.absoluteURL
            ?? baseURL.appending(path: path)
    }
}

struct RecentRecordingsResponse: Decodable, Equatable, Sendable {
    let items: [RecentRecordingDTO]
}

struct RecentRecordingDTO: Decodable, Equatable, Sendable {
    let id: String
    let slug: String
    let title: String
    let kind: String  // "video" | "audio"
    let createdAt: String  // ISO 8601
    let durationSeconds: Double?
    let thumbnailUrl: String?
    let folderId: String?
    let folderName: String?
}

struct ListFoldersResponse: Decodable, Equatable, Sendable {
    let folders: [FolderDTO]
}

struct FolderDTO: Decodable, Equatable, Sendable, Identifiable {
    let id: String
    let name: String
    let parentId: String?
}

struct AssignFolderRequest: Encodable, Sendable {
    let folderId: String?
}

struct NoteBodyRequest: Encodable, Sendable {
    let body: String
}

struct ObsidianSyncedRequest: Encodable, Sendable {
    let filePath: String
}

private struct EmptyRequest: Encodable {}
private struct EmptyResponse: Decodable {}

enum BackendClientError: LocalizedError {
    case nonHTTPResponse(path: String)
    case badStatus(statusCode: Int, path: String, body: Data)
    case decodingFailed(path: String, body: Data, underlyingError: Error)
    case invalidTextResponse(path: String)

    var errorDescription: String? {
        switch self {
        case .nonHTTPResponse(let path):
            return "Backend returned a non-HTTP response for \(path)."
        case .badStatus(let statusCode, let path, let body):
            let bodyText = String(data: body, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let bodyText, !bodyText.isEmpty {
                return "Backend returned HTTP \(statusCode) for \(path): \(bodyText)"
            }
            return "Backend returned HTTP \(statusCode) for \(path)."
        case .decodingFailed(let path, let body, let underlyingError):
            let bodyText = String(data: body, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let bodyText, !bodyText.isEmpty {
                return "Could not read backend JSON for \(path): \(underlyingError.localizedDescription). Response: \(bodyText.prefix(500))"
            }
            return "Could not read backend JSON for \(path): \(underlyingError.localizedDescription)."
        case .invalidTextResponse(let path):
            return "Backend returned non-text content for \(path)."
        }
    }
}
