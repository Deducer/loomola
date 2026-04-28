import Foundation
import Supabase

actor DesktopAuthService {
    private let client: SupabaseClient
    private let store: AuthSessionStore

    init(configuration: DesktopAuthConfiguration, store: AuthSessionStore = AuthSessionStore()) {
        self.store = store
        self.client = store.makeClient(configuration: configuration)
    }

    func restoreSession() async throws -> Session? {
        guard
            let accessToken = try store.loadAccessToken(),
            let refreshToken = try store.loadRefreshToken()
        else {
            return nil
        }
        let session = try await client.auth.setSession(
            accessToken: accessToken,
            refreshToken: refreshToken
        )
        try store.save(session: session)
        return session
    }

    func signIn(email: String, password: String) async throws -> Session {
        let session = try await client.auth.signIn(email: email, password: password)
        try store.save(session: session)
        return session
    }

    func signOut() async throws {
        try await client.auth.signOut()
        try store.clear()
    }
}
