import AppKit
import Foundation
import OSLog

private let log = Logger(subsystem: "cloud.dissonance.loom.desktop", category: "recent")

/// Loomola desktop's "Recent" data source. Fetches the last few
/// recordings from the existing `/api/recordings/recent` endpoint
/// and exposes them as `@Published` items for SwiftUI.
///
/// Refresh triggers:
///   • Initial subscription (on first observed access).
///   • App becomes active (`NSApplication.didBecomeActiveNotification`).
///   • Caller explicitly requests via `refresh()` (e.g., after a
///     successful upload completes).
///   • 5-minute timer while the window is visible.
@MainActor
final class RecentRecordingsService: ObservableObject {
    @Published private(set) var items: [RecentRecording] = []
    @Published private(set) var folders: [FolderDTO] = []
    @Published private(set) var isLoading = false
    @Published private(set) var lastError: String?
    /// Flips to true after the first refresh attempt completes
    /// (success OR failure). Used by RecentStrip to only render the
    /// skeleton on cold launch — without this, every 60-second
    /// refresh re-shows the skeleton briefly, which reads as a
    /// distracting flash.
    @Published private(set) var hasLoaded = false
    /// True while a "Show older" page fetch is in flight.
    @Published private(set) var isLoadingMore = false
    /// Whether the last page fetch for each kind came back full —
    /// i.e. older items probably exist. Drives the "Show older"
    /// affordance.
    @Published private(set) var hasMoreAudio = false
    @Published private(set) var hasMoreVideo = false

    private let backend: BackendClient
    private let limit: Int
    private var refreshTask: Task<Void, Never>?
    private var loadMoreTask: Task<Void, Never>?
    private var refreshTimerTask: Task<Void, Never>?
    /// Observer for `NSApplication.didBecomeActiveNotification`. We
    /// keep a reference so we could remove it on deinit, but Swift 6
    /// concurrency forbids touching non-Sendable state from a
    /// nonisolated deinit. Since the service lives for the app's
    /// lifetime in practice (held by the view model), leaking the
    /// observer is fine — NotificationCenter cleans up at process
    /// exit.
    nonisolated(unsafe) private var didBecomeActiveObserver: NSObjectProtocol?

    init(backend: BackendClient, limit: Int = 12) {
        self.backend = backend
        self.limit = limit
        wireLifecycleObservers()
        // Cold-launch refresh so the strip populates the moment the
        // user lands on the idle home view, instead of waiting on
        // RecentStrip.onAppear (race-prone) or the 60s timer.
        refresh()
    }

    deinit {
        refreshTimerTask?.cancel()
        refreshTask?.cancel()
    }

    /// Force an immediate refresh. Coalesces with any in-flight
    /// refresh — the in-flight task wins and a stale call is a no-op.
    func refresh() {
        guard refreshTask == nil else {
            log.notice("refresh() — skipped, already in flight")
            return
        }
        log.notice("refresh() — starting")
        let task = Task { @MainActor in
            await performRefresh()
            self.refreshTask = nil
        }
        refreshTask = task
    }

    private func performRefresh() async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        // Fan out: videos + notes + folders in parallel. Fetching
        // each media kind separately prevents a run of recent notes
        // from crowding all Loom videos out of the desktop's Video
        // Recent section.
        //
        // Refresh re-fetches at least as many items as are currently
        // loaded (capped at the server's 200) so the periodic timer
        // doesn't truncate a list the user scrolled deeper into.
        let videoLimit = min(200, max(limit, loadedCount(of: .video)))
        let audioLimit = min(200, max(limit, loadedCount(of: .audio)))
        async let videoItemsResponse = fetchRecent(kind: "video", limit: videoLimit)
        async let audioItemsResponse = fetchRecent(kind: "audio", limit: audioLimit)
        async let foldersResponse = backend.listFolders()

        let (videoResult, audioResult) = await (videoItemsResponse, audioItemsResponse)

        var combined: [RecentRecordingDTO] = []
        var failures: [String] = []
        var hadSuccessfulSection = false

        switch videoResult {
        case .success(let response):
            hadSuccessfulSection = true
            combined.append(contentsOf: response.items)
            hasMoreVideo = response.items.count >= videoLimit
        case .failure(let error):
            failures.append("videos: \(error.localizedDescription)")
            log.error("video recents refresh failed: \(error.localizedDescription, privacy: .public)")
        }

        switch audioResult {
        case .success(let response):
            hadSuccessfulSection = true
            combined.append(contentsOf: response.items)
            hasMoreAudio = response.items.count >= audioLimit
        case .failure(let error):
            failures.append("notes: \(error.localizedDescription)")
            log.error("audio recents refresh failed: \(error.localizedDescription, privacy: .public)")
        }

        if hadSuccessfulSection {
            items = combined
                .compactMap { RecentRecording(dto: $0) }
                .sorted { $0.createdAt > $1.createdAt }
        }

        if failures.isEmpty {
            lastError = nil
        } else {
            lastError = failures.joined(separator: "; ")
        }
        let videoCount = (try? videoResult.get().items.count) ?? 0
        let audioCount = (try? audioResult.get().items.count) ?? 0
        log.notice("fetched \(videoCount, privacy: .public) video(s), \(audioCount, privacy: .public) note(s); \(self.items.count, privacy: .public) decoded")

        // Folders fetch is a soft dependency — failure here just
        // disables the folder picker, doesn't block the rows.
        do {
            let response = try await foldersResponse
            folders = response.folders
        } catch {
            log.error("folders fetch failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func fetchRecent(kind: String, limit: Int, offset: Int = 0) async -> Result<RecentRecordingsResponse, Error> {
        do {
            return .success(try await backend.recentRecordings(limit: limit, kind: kind, offset: offset))
        } catch {
            return .failure(error)
        }
    }

    private func loadedCount(of kind: RecentRecording.Kind) -> Int {
        items.filter { $0.kind == kind }.count
    }

    /// Older-history page size. Bigger than the initial page so the
    /// scroll-triggered chain reaches full history in a few requests.
    private let loadMorePageSize = 50

    /// Fetch the next page of older items for one kind and append.
    /// Duplicates (an item that shifted pages because something newer
    /// arrived) are dropped by id.
    func loadMore(kind: RecentRecording.Kind) {
        guard loadMoreTask == nil else { return }
        loadMoreTask = Task { @MainActor in
            defer { loadMoreTask = nil }
            isLoadingMore = true
            defer { isLoadingMore = false }
            let offset = loadedCount(of: kind)
            let result = await fetchRecent(kind: kind.rawValue, limit: loadMorePageSize, offset: offset)
            switch result {
            case .success(let response):
                let known = Set(items.map(\.id))
                let fresh = response.items
                    .compactMap { RecentRecording(dto: $0) }
                    .filter { !known.contains($0.id) }
                items = (items + fresh).sorted { $0.createdAt > $1.createdAt }
                let more = response.items.count >= loadMorePageSize
                if kind == .audio { hasMoreAudio = more } else { hasMoreVideo = more }
                log.notice("loadMore \(kind.rawValue, privacy: .public) — +\(fresh.count, privacy: .public) item(s), offset \(offset, privacy: .public)")
            case .failure(let error):
                log.error("loadMore \(kind.rawValue, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// Full-text search (titles + summaries + transcripts + attendees)
    /// for the sidebar. Best-effort: failures return empty.
    func search(query: String, limit: Int = 15) async -> [SearchResultDTO] {
        do {
            return try await backend.searchRecordings(query: query, limit: limit).items
        } catch {
            log.error("search failed: \(error.localizedDescription, privacy: .public)")
            return []
        }
    }

    /// Optimistically toggle a folder's favorite pin; reverts on failure.
    func setFolderFavorite(_ folder: FolderDTO, isFavorite: Bool) async {
        guard let index = folders.firstIndex(where: { $0.id == folder.id }) else { return }
        let original = folders[index]
        var updated = original
        updated.isFavorite = isFavorite
        folders[index] = updated
        do {
            try await backend.setFolderFavorite(folderId: folder.id, isFavorite: isFavorite)
            log.notice("folder \(folder.id, privacy: .public) favorite=\(isFavorite, privacy: .public)")
        } catch {
            folders[index] = original
            log.error("set favorite failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Optimistically set (or clear, with nil) a folder's emoji icon.
    func setFolderIcon(_ folder: FolderDTO, icon: String?) async {
        guard let index = folders.firstIndex(where: { $0.id == folder.id }) else { return }
        let original = folders[index]
        var updated = original
        updated.icon = icon
        folders[index] = updated
        do {
            try await backend.setFolderIcon(folderId: folder.id, icon: icon)
            log.notice("folder \(folder.id, privacy: .public) icon=\(icon ?? "<cleared>", privacy: .public)")
        } catch {
            folders[index] = original
            log.error("set icon failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Create a new folder and append it to the published list.
    /// Used by the folder picker's inline "+ New folder" action.
    /// Returns the new folder so the caller can immediately assign
    /// the recording to it.
    func createFolder(name: String) async throws -> FolderDTO {
        let folder = try await backend.createFolder(name: name)
        folders = (folders + [folder])
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        log.notice("created folder id=\(folder.id, privacy: .public) name=\(folder.name, privacy: .public)")
        return folder
    }

    /// Soft-delete a batch of recordings via the existing
    /// `/api/recordings/bulk-delete` endpoint. Optimistically wipes
    /// them from the local items array; reverts on failure.
    func bulkDelete(ids: Set<String>) async {
        guard !ids.isEmpty else { return }
        let snapshot = items
        items = items.filter { !ids.contains($0.id) }
        do {
            try await backend.bulkDelete(ids: Array(ids))
            log.notice("bulk-deleted \(ids.count, privacy: .public) recording(s)")
        } catch {
            items = snapshot
            log.error("bulk-delete failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Optimistically update a recording's folder assignment in the
    /// local items array, then persist. The view's folder pill
    /// updates immediately; if the server call fails, we revert and
    /// surface the error.
    func assignFolder(recordingId: String, folderId: String?) async {
        guard let index = items.firstIndex(where: { $0.id == recordingId }) else { return }
        let original = items[index]
        let newFolderName: String?
        if let folderId {
            newFolderName = folders.first(where: { $0.id == folderId })?.name
        } else {
            newFolderName = nil
        }
        items[index] = original.with(folderId: folderId, folderName: newFolderName)
        do {
            try await backend.assignRecordingToFolder(
                recordingId: recordingId,
                folderId: folderId
            )
            log.notice("assigned \(recordingId, privacy: .public) → folder \(folderId ?? "<none>", privacy: .public)")
        } catch {
            // Revert on failure.
            items[index] = original
            log.error("assign folder failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func wireLifecycleObservers() {
        didBecomeActiveObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refresh()
            }
        }
        // Periodic refresh while the app is alive. Launch, activation,
        // and upload events already force immediate refreshes; the timer
        // is only a quiet stale-data safety net.
        refreshTimerTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 300_000_000_000)
                self?.refresh()
            }
        }
    }
}

/// View-layer DTO for a Recent strip card.
struct RecentRecording: Identifiable, Equatable {
    enum Kind: String {
        case video
        case audio
    }

    let id: String
    let slug: String
    let title: String
    let kind: Kind
    let createdAt: Date
    let durationSeconds: Double?
    let status: String?
    let transcriptReady: Bool?
    let thumbnailURL: URL?
    var folderId: String?
    var folderName: String?
    var attendees: [RecentAttendeeDTO]
    var suggestedFolderId: String?
    var calendarEventTitle: String?

    init(
        id: String,
        slug: String,
        title: String,
        kind: Kind,
        createdAt: Date,
        durationSeconds: Double?,
        status: String?,
        transcriptReady: Bool?,
        thumbnailURL: URL?,
        folderId: String?,
        folderName: String?,
        attendees: [RecentAttendeeDTO] = [],
        suggestedFolderId: String? = nil
    ) {
        self.id = id
        self.slug = slug
        self.title = title
        self.kind = kind
        self.createdAt = createdAt
        self.durationSeconds = durationSeconds
        self.status = status
        self.transcriptReady = transcriptReady
        self.thumbnailURL = thumbnailURL
        self.folderId = folderId
        self.folderName = folderName
        self.attendees = attendees
        self.suggestedFolderId = suggestedFolderId
    }

    init?(dto: RecentRecordingDTO) {
        self.id = dto.id
        self.slug = dto.slug
        self.title = dto.title
        guard let kind = Kind(rawValue: dto.kind) else { return nil }
        self.kind = kind
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: dto.createdAt) {
            self.createdAt = date
        } else {
            // Fallback parse without fractional seconds (some endpoints
            // emit the abbreviated form).
            let alt = ISO8601DateFormatter()
            alt.formatOptions = [.withInternetDateTime]
            self.createdAt = alt.date(from: dto.createdAt) ?? Date()
        }
        self.durationSeconds = dto.durationSeconds
        self.status = dto.status
        self.transcriptReady = dto.transcriptReady
        self.thumbnailURL = dto.thumbnailUrl.flatMap { URL(string: $0) }
        self.folderId = dto.folderId
        self.folderName = dto.folderName
        self.attendees = dto.attendees ?? []
        self.suggestedFolderId = dto.suggestedFolderId
        self.calendarEventTitle = dto.calendarEventTitle
    }

    /// Builds a copy with overridden folder assignment. Used by the
    /// optimistic-update path in RecentRecordingsService.assignFolder.
    func with(folderId: String?, folderName: String?) -> RecentRecording {
        var copy = self
        copy.folderId = folderId
        copy.folderName = folderName
        if folderId != nil {
            // Filing the note makes any pending suggestion moot.
            copy.suggestedFolderId = nil
        }
        return copy
    }
}
