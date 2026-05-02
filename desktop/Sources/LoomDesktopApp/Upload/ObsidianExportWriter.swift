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
            let destination = try write(markdown: markdown, note: note)
            try await backend.markObsidianSynced(
                mediaId: note.mediaId,
                filePath: destination.path
            )
            written += 1
        }
        return written
    }

    private func write(markdown: String, note: PendingObsidianNote) throws -> URL {
        let directory = expandHome(in: note.path)
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let destination = directory.appending(path: note.filename)
        try markdown.write(to: destination, atomically: true, encoding: .utf8)
        return destination
    }

    private func expandHome(in path: String) -> URL {
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
}
