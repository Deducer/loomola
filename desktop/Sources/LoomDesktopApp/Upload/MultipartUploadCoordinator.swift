import Foundation
import OSLog

private let multipartUploadLog = Logger(
    subsystem: "cloud.dissonance.loom.desktop",
    category: "multipart-upload"
)

actor MultipartUploadCoordinator {
    static let targetPartSize = 8 * 1024 * 1024
    static let putTimeoutSeconds: TimeInterval = 120
    static let maxPartUploadAttempts = 3

    private let backend: BackendClient

    init(backend: BackendClient) {
        self.backend = backend
    }

    func uploadFile(
        url fileURL: URL,
        recordingId: String,
        track: TrackKind,
        progress: ((MultipartUploadProgress) async -> Void)? = nil
    ) async throws -> [CompletedPart] {
        var completed: [CompletedPart] = []
        let fileSize = try Self.fileSize(fileURL)
        let ranges = Self.partRanges(fileSize: fileSize)
        multipartUploadLog.notice(
            "upload start recording=\(recordingId, privacy: .public) track=\(track.rawValue, privacy: .public) bytes=\(fileSize, privacy: .public) parts=\(ranges.count, privacy: .public)"
        )
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
            let eTag = try await putPart(
                data: partData,
                to: partURL.url,
                track: track,
                partNumber: partNumber,
                totalParts: ranges.count
            )
            completed.append(CompletedPart(partNumber: partNumber, eTag: eTag))
            await progress?(
                MultipartUploadProgress(
                    completedParts: completed.count,
                    totalParts: ranges.count,
                    uploadedBytes: min(partNumber * Self.targetPartSize, fileSize),
                    totalBytes: fileSize
                )
            )
        }

        multipartUploadLog.notice(
            "upload complete recording=\(recordingId, privacy: .public) track=\(track.rawValue, privacy: .public) parts=\(completed.count, privacy: .public)"
        )
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

    private func putPart(
        data: Data,
        to url: URL,
        track: TrackKind,
        partNumber: Int,
        totalParts: Int
    ) async throws -> String {
        var lastError: Error?
        for attempt in 1...Self.maxPartUploadAttempts {
            do {
                var request = URLRequest(url: url)
                request.httpMethod = "PUT"
                request.timeoutInterval = Self.putTimeoutSeconds
                multipartUploadLog.notice(
                    "part upload start track=\(track.rawValue, privacy: .public) part=\(partNumber, privacy: .public)/\(totalParts, privacy: .public) attempt=\(attempt, privacy: .public) bytes=\(data.count, privacy: .public) host=\(url.host ?? "unknown", privacy: .public)"
                )
                let (_, response) = try await URLSession.shared.upload(for: request, from: data)
                guard let http = response as? HTTPURLResponse else {
                    throw MultipartUploadError.badStatus(-1)
                }
                guard (200..<300).contains(http.statusCode) else {
                    let error = MultipartUploadError.badStatus(http.statusCode)
                    if Self.shouldRetryStatus(http.statusCode), attempt < Self.maxPartUploadAttempts {
                        multipartUploadLog.warning(
                            "part upload retryable status track=\(track.rawValue, privacy: .public) part=\(partNumber, privacy: .public) status=\(http.statusCode, privacy: .public) attempt=\(attempt, privacy: .public)"
                        )
                        lastError = error
                        try await Self.sleepBeforeRetry(attempt: attempt)
                        continue
                    }
                    throw error
                }
                guard let eTag = http.value(forHTTPHeaderField: "ETag") else {
                    throw MultipartUploadError.missingETag
                }
                multipartUploadLog.notice(
                    "part upload complete track=\(track.rawValue, privacy: .public) part=\(partNumber, privacy: .public)/\(totalParts, privacy: .public) attempt=\(attempt, privacy: .public) status=\(http.statusCode, privacy: .public)"
                )
                return eTag
            } catch {
                lastError = error
                if case MultipartUploadError.badStatus(let statusCode) = error,
                   !Self.shouldRetryStatus(statusCode)
                {
                    throw error
                }
                if attempt < Self.maxPartUploadAttempts {
                    multipartUploadLog.warning(
                        "part upload failed; retrying track=\(track.rawValue, privacy: .public) part=\(partNumber, privacy: .public) attempt=\(attempt, privacy: .public) error=\(error.localizedDescription, privacy: .public)"
                    )
                    try await Self.sleepBeforeRetry(attempt: attempt)
                    continue
                }
            }
        }
        throw lastError ?? MultipartUploadError.badStatus(-1)
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

    private static func shouldRetryStatus(_ statusCode: Int) -> Bool {
        statusCode == 408 || statusCode == 429 || (500..<600).contains(statusCode)
    }

    private static func sleepBeforeRetry(attempt: Int) async throws {
        let delaySeconds = min(attempt * 2, 6)
        try await Task.sleep(nanoseconds: UInt64(delaySeconds) * 1_000_000_000)
    }
}

enum MultipartUploadError: Error {
    case badStatus(Int)
    case missingETag
    case unexpectedEndOfFile
}

struct MultipartUploadProgress: Sendable {
    let completedParts: Int
    let totalParts: Int
    let uploadedBytes: Int
    let totalBytes: Int

    var fraction: Double {
        guard totalParts > 0 else { return 1 }
        return Double(completedParts) / Double(totalParts)
    }
}
