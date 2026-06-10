import Foundation

actor ObsidianExportWriter {
    private let backend: BackendClient
    private let fileManager: FileManager

    init(backend: BackendClient, fileManager: FileManager = .default) {
        self.backend = backend
        self.fileManager = fileManager
    }

    func syncPending() async throws -> Int {
        let pending = try await backend.pendingObsidianNotes()
        var written = 0
        for note in pending.notes {
            let markdown = try await backend.noteMarkdownExport(mediaId: note.mediaId)
            let destination = try write(
                markdown: markdown,
                mediaId: note.mediaId,
                path: note.path,
                filename: note.filename
            )
            try await backend.markObsidianSynced(
                mediaId: note.mediaId,
                filePath: destination.path
            )
            written += 1
        }
        return written
    }

    func write(
        markdown: String,
        mediaId: String,
        path: String,
        filename: String
    ) throws -> URL {
        let directory = Self.expandHome(in: path, fileManager: fileManager)
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let destination = Self.existingDestination(
            for: mediaId,
            in: directory,
            fileManager: fileManager
        ) ?? directory.appending(path: filename)
        try markdown.write(to: destination, atomically: true, encoding: .utf8)
        return destination
    }

    static func existingDestination(
        for mediaId: String,
        in directory: URL,
        fileManager: FileManager = .default
    ) -> URL? {
        guard let enumerator = fileManager.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else { return nil }

        for case let fileURL as URL in enumerator {
            guard fileURL.pathExtension.lowercased() == "md" else { continue }
            let values = try? fileURL.resourceValues(forKeys: [.isRegularFileKey])
            guard values?.isRegularFile == true else { continue }
            guard
                let data = try? Data(contentsOf: fileURL, options: .mappedIfSafe),
                let markdown = String(data: data, encoding: .utf8),
                frontmatterMeetingId(in: markdown) == mediaId
            else { continue }
            return fileURL
        }

        return nil
    }

    static func frontmatterMeetingId(in markdown: String) -> String? {
        let lines = markdown.components(separatedBy: .newlines)
        guard lines.first?.trimmingCharacters(in: .whitespacesAndNewlines) == "---" else {
            return nil
        }

        for line in lines.dropFirst() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed == "---" { return nil }
            guard trimmed.hasPrefix("meeting_id:") else { continue }
            let value = trimmed
                .dropFirst("meeting_id:".count)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return unquoteYamlScalar(value)
        }

        return nil
    }

    static func expandHome(in path: String, fileManager: FileManager = .default) -> URL {
        let normalized = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized == "~" {
            return fileManager.homeDirectoryForCurrentUser
        }
        if normalized.hasPrefix("~/") {
            return fileManager.homeDirectoryForCurrentUser
                .appending(path: String(normalized.dropFirst(2)))
        }
        return URL(fileURLWithPath: normalized)
    }

    private static func unquoteYamlScalar(_ value: String) -> String {
        guard value.count >= 2 else { return value }
        let first = value.first
        let last = value.last
        if first == "\"" && last == "\"" {
            return String(value.dropFirst().dropLast())
                .replacingOccurrences(of: "\\\"", with: "\"")
        }
        if first == "'" && last == "'" {
            return String(value.dropFirst().dropLast())
        }
        return value
    }
}
