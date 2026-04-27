import Foundation

actor MultipartUploadCoordinator {
    static let targetPartSize = 8 * 1024 * 1024

    private let backend: BackendClient

    init(backend: BackendClient) {
        self.backend = backend
    }

    func uploadFile(
        url fileURL: URL,
        recordingId: String,
        track: TrackKind
    ) async throws -> [CompletedPart] {
        let data = try Data(contentsOf: fileURL)
        var completed: [CompletedPart] = []
        var offset = 0
        var partNumber = 1

        while offset < data.count {
            let end = min(offset + Self.targetPartSize, data.count)
            let partData = data.subdata(in: offset..<end)
            let partURL = try await backend.partURL(
                recordingId: recordingId,
                request: PartURLRequest(track: track, partNumber: partNumber)
            )
            let eTag = try await putPart(data: partData, to: partURL.url)
            completed.append(CompletedPart(partNumber: partNumber, eTag: eTag))
            offset = end
            partNumber += 1
        }

        return completed
    }

    private func putPart(data: Data, to url: URL) async throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        let (_, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw MultipartUploadError.badStatus((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        guard let eTag = http.value(forHTTPHeaderField: "ETag") else {
            throw MultipartUploadError.missingETag
        }
        return eTag
    }
}

enum MultipartUploadError: Error {
    case badStatus(Int)
    case missingETag
}
