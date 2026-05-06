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
        do {
            let response = try await backend.recentRecordings(limit: limit)
            let mapped = response.items.compactMap { RecentRecording(dto: $0) }
            items = mapped
            lastError = nil
            log.notice("fetched \(response.items.count, privacy: .public) item(s); \(mapped.count, privacy: .public) decoded")
            for (i, item) in response.items.enumerated() {
                log.notice("  item[\(i, privacy: .public)] id=\(item.id, privacy: .public) kind=\(item.kind, privacy: .public) slug=\(item.slug, privacy: .public)")
            }
        } catch {
            // Don't blank out items on error — keep showing the last
            // good list. Surface the error for debug.
            lastError = error.localizedDescription
            log.error("refresh failed: \(error.localizedDescription, privacy: .public)")
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
    }
}
