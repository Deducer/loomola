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
        var completed: [CompletedPart] = []
        let fileSize = try Self.fileSize(fileURL)
        let ranges = Self.partRanges(fileSize: fileSize)
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }

        for (index, range) in ranges.enumerated() {
            let partNumber = index + 1
            let partData = try Self.readPart(from: handle, byteCount: range.count)
            guard partData.count == range.count else {
                throw MultipartUploadError.unexpectedEndOfFile
            }
            let partURL = try await backend.partURL(
                recordingId: recordingId,
                request: PartURLRequest(track: track, partNumber: partNumber)
            )
            let eTag = try await putPart(data: partData, to: partURL.url)
            completed.append(CompletedPart(partNumber: partNumber, eTag: eTag))
        }

        return completed
    }

    static func partRanges(
        fileSize: Int,
        partSize: Int = MultipartUploadCoordinator.targetPartSize
    ) -> [Range<Int>] {
        guard fileSize > 0 else { return [] }
        var ranges: [Range<Int>] = []
        var offset = 0
        while offset < fileSize {
            let end = min(offset + partSize, fileSize)
            ranges.append(offset..<end)
            offset = end
        }
        return ranges
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

    private static func fileSize(_ url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes[.size] as? NSNumber)?.intValue ?? 0
    }

    private static func readPart(from handle: FileHandle, byteCount: Int) throws -> Data {
        var data = Data()
        var remaining = byteCount
        while remaining > 0 {
            guard let chunk = try handle.read(upToCount: remaining), !chunk.isEmpty else {
                break
            }
            data.append(chunk)
            remaining -= chunk.count
        }
        return data
    }
}

enum MultipartUploadError: Error {
    case badStatus(Int)
    case missingETag
    case unexpectedEndOfFile
}
