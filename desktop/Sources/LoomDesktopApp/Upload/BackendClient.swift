import Foundation

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

    private func post<RequestBody: Encodable, ResponseBody: Decodable>(
        path: String,
        body: RequestBody
    ) async throws -> ResponseBody {
        let token = try await accessTokenProvider()
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
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

    let tracks: [Track]
    let resolution: String
    let brandProfileId: String?
    let client = "macos"
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
}

struct CompleteRecordingResponse: Decodable, Equatable, Sendable {
    let slug: String
}

private struct EmptyRequest: Encodable {}
private struct EmptyResponse: Decodable {}

enum BackendClientError: LocalizedError {
    case nonHTTPResponse(path: String)
    case badStatus(statusCode: Int, path: String, body: Data)
    case decodingFailed(path: String, body: Data, underlyingError: Error)

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
        }
    }
}
