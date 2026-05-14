import Foundation
import Supabase

struct StoredDesktopSession: Sendable {
    let accessToken: String
    let userId: UUID?
    let email: String?
}

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

    func loadStoredSessionSnapshot() throws -> StoredDesktopSession? {
        guard let accessToken = try store.loadAccessToken() else { return nil }
        let claims = Self.decodeAccessTokenClaims(accessToken)
        return StoredDesktopSession(
            accessToken: accessToken,
            userId: claims.sub.flatMap(UUID.init(uuidString:)),
            email: claims.email
        )
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

    static func decodeAccessTokenClaims(_ token: String) -> AccessTokenClaims {
        let parts = token.split(separator: ".")
        guard parts.count >= 2,
              let payloadData = base64URLDecode(String(parts[1])),
              let claims = try? JSONDecoder().decode(AccessTokenClaims.self, from: payloadData)
        else {
            return AccessTokenClaims()
        }
        return claims
    }

    private static func base64URLDecode(_ value: String) -> Data? {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }
        return Data(base64Encoded: base64)
    }
}

struct AccessTokenClaims: Decodable, Equatable {
    var sub: String? = nil
    var email: String? = nil
}
