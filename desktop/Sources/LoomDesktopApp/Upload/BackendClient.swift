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

    func recentRecordings(limit: Int = 4, kind: String? = nil) async throws -> RecentRecordingsResponse {
        var path = "/api/recordings/recent?limit=\(limit)"
        if let kind {
            path += "&kind=\(kind)"
        }
        return try await get(path: path)
    }

    func listFolders() async throws -> ListFoldersResponse {
        try await get(path: "/api/folders")
    }

    func listNoteTemplates() async throws -> NoteTemplatesResponse {
        try await get(path: "/api/note-templates")
    }

    func getUserPreferences() async throws -> UserPreferencesResponse {
        try await get(path: "/api/preferences")
    }

    func updateUserPreferences(_ request: UpdateUserPreferencesRequest) async throws -> UserPreferencesResponse {
        try await jsonRequest(method: "PATCH", path: "/api/preferences", body: request)
    }

    func assignRecordingToFolder(recordingId: String, folderId: String?) async throws {
        let _: EmptyResponse = try await jsonRequest(
            method: "PATCH",
            path: "/api/recordings/\(recordingId)/folder",
            body: AssignFolderRequest(folderId: folderId)
        )
    }

    func createFolder(name: String, parentId: String? = nil) async throws -> FolderDTO {
        let response: CreateFolderResponse = try await post(
            path: "/api/folders",
            body: CreateFolderRequest(name: name, parentId: parentId)
        )
        return response.folder
    }

    func bulkDelete(ids: [String]) async throws {
        let _: EmptyResponse = try await post(
            path: "/api/recordings/bulk-delete",
            body: BulkDeleteRequest(ids: ids)
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

    /// Fetch a note's body for the workspace's review-mode flow
    /// (clicking an audio note from Recent). The endpoint returns
    /// `{ body: "..." }` (or `{ body: "" }` if the note row hasn't
    /// been written yet).
    func getNoteBody(mediaId: String) async throws -> String {
        let response: NoteBodyResponse = try await get(
            path: "/api/notes/\(mediaId)"
        )
        return response.body ?? ""
    }

    func getNote(mediaId: String) async throws -> NoteBodyResponse {
        try await get(path: "/api/notes/\(mediaId)")
    }

    func setNoteTemplate(mediaId: String, templateId: String) async throws {
        let _: EmptyResponse = try await jsonRequest(
            method: "PATCH",
            path: "/api/notes/\(mediaId)/template",
            body: NoteTemplateSelectionRequest(templateId: templateId)
        )
    }

    /// List image attachments for a note. Returns presigned URLs
    /// the desktop can render directly; expires in ~1 hour.
    func listNoteAttachments(mediaId: String) async throws -> [NoteAttachmentDTO] {
        let response: ListAttachmentsResponse = try await get(
            path: "/api/notes/\(mediaId)/attachments"
        )
        return response.attachments
    }

    /// Upload an image to a note as an attachment.
    /// Server constraints: 12 MB max, png/jpeg/webp/gif.
    /// Returns the new attachment with presigned URL.
    func uploadNoteAttachment(mediaId: String, fileURL: URL) async throws -> NoteAttachmentDTO {
        let data = try Data(contentsOf: fileURL)
        let filename = fileURL.lastPathComponent
        let contentType = inferContentType(for: fileURL)

        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(contentType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        let token = try await accessTokenProvider()
        let url = makeURL(path: "/api/notes/\(mediaId)/attachments")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.httpBody = body
        log.notice("POST \(url.absoluteString, privacy: .public) (multipart, \(data.count, privacy: .public) bytes)")

        let (responseData, response) = try await session.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else {
            throw BackendClientError.nonHTTPResponse(path: "/api/notes/\(mediaId)/attachments")
        }
        log.notice("POST attachment → \(http.statusCode, privacy: .public) (\(responseData.count, privacy: .public) bytes)")
        if let serviceErr = detectServiceUnavailable(data: responseData, response: http, path: "/api/notes/\(mediaId)/attachments") {
            throw serviceErr
        }
        guard (200..<300).contains(http.statusCode) else {
            let bodyPreview = String(data: responseData.prefix(400), encoding: .utf8) ?? "<binary>"
            log.error("POST attachment → \(http.statusCode, privacy: .public) body=\(bodyPreview, privacy: .public)")
            throw BackendClientError.badStatus(
                statusCode: http.statusCode,
                path: "/api/notes/\(mediaId)/attachments",
                body: responseData
            )
        }
        let envelope = try JSONDecoder().decode(CreateAttachmentResponse.self, from: responseData)
        return envelope.attachment
    }

    /// Soft-delete a note attachment. Used by the workspace's
    /// right-click → Remove flow.
    func deleteNoteAttachment(mediaId: String, attachmentId: String) async throws {
        let token = try await accessTokenProvider()
        let url = makeURL(path: "/api/notes/\(mediaId)/attachments/\(attachmentId)")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BackendClientError.nonHTTPResponse(path: "/api/notes/\(mediaId)/attachments/\(attachmentId)")
        }
        if let serviceErr = detectServiceUnavailable(data: data, response: http, path: "/api/notes/\(mediaId)/attachments/\(attachmentId)") {
            throw serviceErr
        }
        guard (200..<300).contains(http.statusCode) else {
            throw BackendClientError.badStatus(
                statusCode: http.statusCode,
                path: "/api/notes/\(mediaId)/attachments/\(attachmentId)",
                body: data
            )
        }
    }

    /// Trigger AI re-enhancement for an audio note (Granola's
    /// "Generate notes" button). Returns 202 — the work runs as
    /// a pg-boss job. Poll `getEnhancementStatus` for completion.
    func enhanceNote(mediaId: String, templateId: String?) async throws {
        let token = try await accessTokenProvider()
        let url = makeURL(path: "/api/notes/\(mediaId)/enhance")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(EnhanceNoteRequest(templateId: templateId))
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BackendClientError.nonHTTPResponse(path: "/api/notes/\(mediaId)/enhance")
        }
        if let serviceErr = detectServiceUnavailable(data: data, response: http, path: "/api/notes/\(mediaId)/enhance") {
            throw serviceErr
        }
        guard (200..<300).contains(http.statusCode) else {
            throw BackendClientError.badStatus(
                statusCode: http.statusCode,
                path: "/api/notes/\(mediaId)/enhance",
                body: data
            )
        }
    }

    /// Read the current AI-enhancement state for an audio note.
    /// Used by the workspace to poll for completion after firing
    /// `enhanceNote`. Returns title + summary + status.
    func getEnhancementStatus(mediaId: String) async throws -> EnhanceStatusResponse {
        try await get(path: "/api/notes/\(mediaId)/enhance")
    }

    func serverVersion() async throws -> ServerVersionResponse {
        try await get(path: "/api/health/version")
    }

    private func inferContentType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        default: return "application/octet-stream"
        }
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

    /// Recognises the HTML brownout page pattern. Production sits behind
    /// Traefik on Coolify; during a deploy/restart loop Traefik returns
    /// its fallback page (occasionally with 200 OK, more often 502/503).
    /// Without this check the desktop's JSON decoder explodes deep in
    /// the call site with a misleading "couldn't read backend JSON"
    /// error — masking the real problem (service unavailable). On
    /// 2026-05-06 a 72-min audio note was lost because the multipart
    /// upload hit this case mid-flight and the desktop interpreted it
    /// as a generic decode failure.
    private func detectServiceUnavailable(
        data: Data, response: HTTPURLResponse, path: String
    ) -> BackendClientError? {
        let contentType = (response.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        if contentType.contains("text/html") {
            return .serviceUnavailable(path: path, statusCode: response.statusCode)
        }
        let bodyPrefix = String(data: data.prefix(32), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if bodyPrefix.hasPrefix("<!doctype") || bodyPrefix.hasPrefix("<html") {
            return .serviceUnavailable(path: path, statusCode: response.statusCode)
        }
        return nil
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
        if let serviceErr = detectServiceUnavailable(data: data, response: http, path: path) {
            log.error("GET \(path, privacy: .public) — service unavailable (HTML brownout, status=\(http.statusCode, privacy: .public))")
            throw serviceErr
        }
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
        if let serviceErr = detectServiceUnavailable(data: data, response: http, path: path) {
            throw serviceErr
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
    let status: String?
    let transcriptReady: Bool?
    let thumbnailUrl: String?
    let folderId: String?
    let folderName: String?

    init(
        id: String,
        slug: String,
        title: String,
        kind: String,
        createdAt: String,
        durationSeconds: Double?,
        thumbnailUrl: String?,
        folderId: String?,
        folderName: String?,
        status: String? = nil,
        transcriptReady: Bool? = nil
    ) {
        self.id = id
        self.slug = slug
        self.title = title
        self.kind = kind
        self.createdAt = createdAt
        self.durationSeconds = durationSeconds
        self.status = status
        self.transcriptReady = transcriptReady
        self.thumbnailUrl = thumbnailUrl
        self.folderId = folderId
        self.folderName = folderName
    }
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

struct CreateFolderRequest: Encodable, Sendable {
    let name: String
    let parentId: String?
}

struct CreateFolderResponse: Decodable, Sendable {
    let folder: FolderDTO
}

struct BulkDeleteRequest: Encodable, Sendable {
    let ids: [String]
}

struct ServerVersionResponse: Decodable, Equatable, Sendable {
    let app: String
    let commit: String
    let buildTime: String?
    let environment: String?
}

struct NoteBodyRequest: Encodable, Sendable {
    let body: String
}

struct NoteBodyResponse: Decodable, Sendable {
    let body: String?
    let templateId: String?
}

struct NoteTemplateSelectionRequest: Encodable, Sendable {
    let templateId: String
}

struct EnhanceNoteRequest: Encodable, Sendable {
    let templateId: String?

    enum CodingKeys: String, CodingKey {
        case templateId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(templateId, forKey: .templateId)
    }
}

struct NoteTemplatesResponse: Decodable, Sendable {
    let templates: [NoteTemplateDTO]
}

struct NoteTemplateDTO: Decodable, Equatable, Sendable, Identifiable {
    struct Section: Decodable, Equatable, Sendable {
        let title: String
        let prompt: String
    }

    let id: String
    let name: String
    let category: String
    let description: String
    let meetingContext: String
    let sections: [Section]
}

struct UserPreferencesResponse: Decodable, Sendable {
    let preferences: UserPreferencesDTO
}

struct UserPreferencesDTO: Decodable, Equatable, Sendable {
    var transcriptionLanguage: String
    var summaryLanguage: String
    var transcriptRetentionDays: Int?
    var meetingDetectionEnabled: Bool
    var floatingRecordingIndicatorEnabled: Bool
    var notifyFirstView: Bool
    var notifyComments: Bool
    var notifyMarketing: Bool

    static let defaults = UserPreferencesDTO(
        transcriptionLanguage: "en",
        summaryLanguage: "same-as-transcript",
        transcriptRetentionDays: nil,
        meetingDetectionEnabled: true,
        floatingRecordingIndicatorEnabled: true,
        notifyFirstView: true,
        notifyComments: true,
        notifyMarketing: false
    )
}

struct UpdateUserPreferencesRequest: Encodable, Sendable {
    var transcriptionLanguage: String?
    var summaryLanguage: String?
    var transcriptRetentionDays: Int?
    var encodeTranscriptRetentionDays = false
    var meetingDetectionEnabled: Bool?
    var floatingRecordingIndicatorEnabled: Bool?
    var notifyFirstView: Bool?
    var notifyComments: Bool?
    var notifyMarketing: Bool?

    enum CodingKeys: String, CodingKey {
        case transcriptionLanguage
        case summaryLanguage
        case transcriptRetentionDays
        case meetingDetectionEnabled
        case floatingRecordingIndicatorEnabled
        case notifyFirstView
        case notifyComments
        case notifyMarketing
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(transcriptionLanguage, forKey: .transcriptionLanguage)
        try container.encodeIfPresent(summaryLanguage, forKey: .summaryLanguage)
        if encodeTranscriptRetentionDays {
            if let transcriptRetentionDays {
                try container.encode(transcriptRetentionDays, forKey: .transcriptRetentionDays)
            } else {
                try container.encodeNil(forKey: .transcriptRetentionDays)
            }
        }
        try container.encodeIfPresent(meetingDetectionEnabled, forKey: .meetingDetectionEnabled)
        try container.encodeIfPresent(floatingRecordingIndicatorEnabled, forKey: .floatingRecordingIndicatorEnabled)
        try container.encodeIfPresent(notifyFirstView, forKey: .notifyFirstView)
        try container.encodeIfPresent(notifyComments, forKey: .notifyComments)
        try container.encodeIfPresent(notifyMarketing, forKey: .notifyMarketing)
    }
}

struct NoteAttachmentDTO: Decodable, Equatable, Sendable, Identifiable {
    let id: String
    let filename: String
    let contentType: String
    let byteSize: Int
    let createdAt: String
    let url: String
}

struct ListAttachmentsResponse: Decodable, Sendable {
    let attachments: [NoteAttachmentDTO]
}

struct CreateAttachmentResponse: Decodable, Sendable {
    let attachment: NoteAttachmentDTO
}

/// Response shape from GET /api/notes/<id>/enhance. Chapters /
/// actionItems are jsonb in the DB and don't have stable shapes
/// the desktop needs yet — keep them out and add later if a UI
/// surface needs them.
struct EnhanceStatusResponse: Decodable, Sendable {
    let titleSuggested: String?
    let summary: String?
    let templateId: String?
    let generationStatus: String  // "pending" | "streaming" | "complete" | "failed"
    let mediaStatus: String?
    let transcriptReady: Bool?
    let transcriptTextLength: Int?
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
    /// The server returned an HTML error / maintenance page instead of
    /// the JSON we expected. Traefik / Coolify brownouts emit their
    /// fallback HTML page (sometimes with 200, sometimes 5xx) — either
    /// way the right answer is "service is unavailable, please retry,"
    /// not "decoder failed on bad JSON." Detected by content-type or
    /// body prefix in `BackendClient.detectServiceUnavailable`.
    case serviceUnavailable(path: String, statusCode: Int)

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
        case .serviceUnavailable(let path, let statusCode):
            return "Loomola is temporarily unavailable (\(statusCode)) at \(path). Wait a moment and try again."
        }
    }

    /// True when the failure is something a retry might fix on its own
    /// (transient outage, brownout). Callers can use this to decide
    /// whether to show "retry" UI vs a hard failure.
    var isTransient: Bool {
        switch self {
        case .serviceUnavailable: return true
        case .badStatus(let code, _, _): return code == 502 || code == 503 || code == 504
        default: return false
        }
    }

    var apiErrorCode: String? {
        guard case .badStatus(_, _, let body) = self,
              let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
        else { return nil }
        return object["error"] as? String
    }
}
