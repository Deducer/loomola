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
///   • 60-second timer while the window is visible.
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

    private let backend: BackendClient
    private let limit: Int
    private var refreshTask: Task<Void, Never>?
    private var refreshTimerTask: Task<Void, Never>?
    /// Observer for `NSApplication.didBecomeActiveNotification`. We
    /// keep a reference so we could remove it on deinit, but Swift 6
    /// concurrency forbids touching non-Sendable state from a
    /// nonisolated deinit. Since the service lives for the app's
    /// lifetime in practice (held by the view model), leaking the
    /// observer is fine — NotificationCenter cleans up at process
    /// exit.
    nonisolated(unsafe) private var didBecomeActiveObserver: NSObjectProtocol?

    init(backend: BackendClient, limit: Int = 30) {
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
        // Fan out: items + folders in parallel so the row UI has
        // both ready when the first paint lands.
        async let itemsResponse = backend.recentRecordings(limit: limit)
        async let foldersResponse = backend.listFolders()
        do {
            let response = try await itemsResponse
            let mapped = response.items.compactMap { RecentRecording(dto: $0) }
            items = mapped
            lastError = nil
            log.notice("fetched \(response.items.count, privacy: .public) item(s); \(mapped.count, privacy: .public) decoded")
        } catch {
            lastError = error.localizedDescription
            log.error("refresh failed: \(error.localizedDescription, privacy: .public)")
        }
        // Folders fetch is a soft dependency — failure here just
        // disables the folder picker, doesn't block the rows.
        do {
            let response = try await foldersResponse
            folders = response.folders
        } catch {
            log.error("folders fetch failed: \(error.localizedDescription, privacy: .public)")
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
        // Periodic refresh — every 60s, while the app is alive. Lazy
        // task; cancels on deinit.
        refreshTimerTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
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
    let thumbnailURL: URL?
    var folderId: String?
    var folderName: String?

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
        self.thumbnailURL = dto.thumbnailUrl.flatMap { URL(string: $0) }
        self.folderId = dto.folderId
        self.folderName = dto.folderName
    }

    /// Builds a copy with overridden folder assignment. Used by the
    /// optimistic-update path in RecentRecordingsService.assignFolder.
    func with(folderId: String?, folderName: String?) -> RecentRecording {
        var copy = self
        copy.folderId = folderId
        copy.folderName = folderName
        return copy
    }
}
