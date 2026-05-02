import Foundation
import Supabase

actor ObsidianRealtimeSubscriber {
    private let configuration: DesktopAuthConfiguration
    private let accessTokenProvider: @Sendable () async throws -> String
    private var client: SupabaseClient?
    private var channel: RealtimeChannelV2?
    private var changeTask: Task<Void, Never>?

    init(
        configuration: DesktopAuthConfiguration,
        accessTokenProvider: @escaping @Sendable () async throws -> String
    ) {
        self.configuration = configuration
        self.accessTokenProvider = accessTokenProvider
    }

    func start(
        userId: UUID,
        onSyncRequested: @escaping @Sendable () async -> Void
    ) async throws {
        await stop()

        let accessTokenProvider = self.accessTokenProvider
        let client = SupabaseClient(
            supabaseURL: configuration.supabaseURL,
            supabaseKey: configuration.anonKey,
            options: SupabaseClientOptions(
                auth: .init(accessToken: { try await accessTokenProvider() })
            )
        )
        let channel = client.channel("obsidian-sync-\(userId.uuidString)")
        let changes = channel.postgresChange(
            UpdateAction.self,
            schema: "public",
            table: "media_objects",
            filter: .eq("owner_id", value: userId)
        )

        changeTask = Task {
            for await change in changes {
                guard Self.shouldTriggerSync(record: change.record) else { continue }
                await onSyncRequested()
            }
        }
        do {
            try await channel.subscribeWithError()
        } catch {
            changeTask?.cancel()
            changeTask = nil
            throw error
        }

        self.client = client
        self.channel = channel
    }

    func stop() async {
        changeTask?.cancel()
        changeTask = nil
        if let client, let channel {
            await client.removeChannel(channel)
        }
        channel = nil
        client = nil
    }

    static func shouldTriggerSync(record: [String: AnyJSON]) -> Bool {
        guard record["type"]?.stringValue == "audio" else { return false }
        guard let requestedAt = record["obsidian_save_requested_at"], !requestedAt.isNil else {
            return false
        }
        return record["obsidian_synced_at"]?.isNil ?? true
    }
}
