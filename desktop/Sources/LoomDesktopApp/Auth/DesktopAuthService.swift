import Foundation
import Supabase

struct StoredDesktopSession: Sendable {
    let accessToken: String
    let userId: UUID?
    let email: String?
}

actor DesktopAuthService {
    private let configuration: DesktopAuthConfiguration
    private let client: SupabaseClient
    private let store: AuthSessionStore

    init(configuration: DesktopAuthConfiguration, store: AuthSessionStore = AuthSessionStore()) {
        self.configuration = configuration
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

    func loadStoredSessionSnapshot() async throws -> StoredDesktopSession? {
        guard let accessToken = try store.loadAccessToken() else { return nil }
        var tokenForSnapshot = accessToken
        var claims = Self.decodeAccessTokenClaims(accessToken)
        if claims.isExpired() {
            guard let refreshToken = try store.loadRefreshToken() else { return nil }
            let refreshed = try await refreshStoredSession(refreshToken: refreshToken)
            try store.saveAccessToken(refreshed.accessToken)
            try store.saveRefreshToken(refreshed.refreshToken)
            tokenForSnapshot = refreshed.accessToken
            claims = Self.decodeAccessTokenClaims(refreshed.accessToken)
        }
        return StoredDesktopSession(
            accessToken: tokenForSnapshot,
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

    private func refreshStoredSession(refreshToken: String) async throws -> RefreshTokenResponse {
        var components = URLComponents(
            url: configuration.supabaseURL.appending(path: "auth/v1/token"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "grant_type", value: "refresh_token")
        ]
        guard let url = components?.url else {
            throw DesktopAuthRefreshError.invalidRefreshURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue(configuration.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(configuration.anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RefreshTokenRequest(refreshToken: refreshToken))

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw DesktopAuthRefreshError.refreshFailed
        }
        return try JSONDecoder().decode(RefreshTokenResponse.self, from: data)
    }
}

struct AccessTokenClaims: Decodable, Equatable {
    var sub: String? = nil
    var email: String? = nil
    var exp: TimeInterval? = nil

    func isExpired(now: Date = Date(), leeway: TimeInterval = 60) -> Bool {
        guard let exp else { return false }
        return Date(timeIntervalSince1970: exp).timeIntervalSince(now) <= leeway
    }
}

private struct RefreshTokenRequest: Encodable {
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case refreshToken = "refresh_token"
    }
}

private struct RefreshTokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}

private enum DesktopAuthRefreshError: Error {
    case invalidRefreshURL
    case refreshFailed
}
