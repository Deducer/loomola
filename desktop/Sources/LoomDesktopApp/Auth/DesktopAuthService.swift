import Foundation

struct StoredDesktopSession: Sendable {
    let accessToken: String
    let userId: UUID?
    let email: String?
}

/// The ONLY component allowed to consume a Supabase refresh token.
///
/// Talks to Supabase's REST auth endpoints directly — deliberately no
/// SupabaseClient here. The SDK's default `autoRefreshToken` runs a second
/// refresh loop on every app-becomes-active with its own private session
/// copy; Supabase rotates refresh tokens on every use and revokes the whole
/// token family on reuse, so two refreshers eventually kill each other's
/// sessions. That is exactly what stranded the 111-minute recording on
/// 2026-07-07 (`refresh_token_already_used` at upload time).
actor DesktopAuthService {
    private let configuration: DesktopAuthConfiguration
    private let store: AuthSessionStore
    private let refreshSession: @Sendable (String) async throws -> RefreshTokenResponse
    private let passwordGrant: @Sendable (String, String) async throws -> RefreshTokenResponse
    private var refreshTask: Task<RefreshTokenResponse, Error>?

    init(
        configuration: DesktopAuthConfiguration,
        store: AuthSessionStore = AuthSessionStore(),
        refreshSession: (@Sendable (String) async throws -> RefreshTokenResponse)? = nil,
        passwordGrant: (@Sendable (String, String) async throws -> RefreshTokenResponse)? = nil
    ) {
        self.configuration = configuration
        self.store = store
        self.refreshSession = refreshSession ?? { refreshToken in
            try await Self.refreshStoredSession(
                refreshToken: refreshToken,
                configuration: configuration
            )
        }
        self.passwordGrant = passwordGrant ?? { email, password in
            try await Self.passwordGrantSession(
                email: email,
                password: password,
                configuration: configuration
            )
        }
    }

    /// App-launch restore: returns the stored session, refreshing first when
    /// it is near expiry. Nil when nothing is stored.
    func restoreSession() async throws -> StoredDesktopSession? {
        try await freshenStoredSessionSnapshot()
    }

    func loadStoredSessionSnapshot() async throws -> StoredDesktopSession? {
        guard let accessToken = try store.loadAccessToken() else { return nil }
        let claims = Self.decodeAccessTokenClaims(accessToken)
        if claims.isExpired() {
            return try await refreshStoredSessionSnapshot()
        }
        return StoredDesktopSession(
            accessToken: accessToken,
            userId: claims.sub.flatMap(UUID.init(uuidString:)),
            email: claims.email
        )
    }

    /// Recording-start preflight: only hits the network when the stored token is
    /// within `minimumRemaining` seconds of expiry, and falls back to the still-valid
    /// cached token when the refresh fails. A brief Supabase blip must never block
    /// starting a local recording.
    func freshenStoredSessionSnapshot(minimumRemaining: TimeInterval = 900) async throws -> StoredDesktopSession? {
        guard let accessToken = try store.loadAccessToken() else { return nil }
        let claims = Self.decodeAccessTokenClaims(accessToken)
        let cached = StoredDesktopSession(
            accessToken: accessToken,
            userId: claims.sub.flatMap(UUID.init(uuidString:)),
            email: claims.email
        )
        if !claims.isExpired(leeway: minimumRemaining) {
            return cached
        }
        do {
            return try await refreshStoredSessionSnapshot()
        } catch {
            if !claims.isExpired() {
                return cached
            }
            throw error
        }
    }

    func refreshStoredSessionSnapshot() async throws -> StoredDesktopSession? {
        guard let refreshToken = try store.loadRefreshToken() else { return nil }
        let refreshed = try await refreshStoredSession(refreshToken: refreshToken)
        try store.saveAccessToken(refreshed.accessToken)
        try store.saveRefreshToken(refreshed.refreshToken)
        let claims = Self.decodeAccessTokenClaims(refreshed.accessToken)
        return StoredDesktopSession(
            accessToken: refreshed.accessToken,
            userId: claims.sub.flatMap(UUID.init(uuidString:)),
            email: claims.email
        )
    }

    func signIn(email: String, password: String) async throws -> StoredDesktopSession {
        let granted = try await passwordGrant(email, password)
        try store.saveAccessToken(granted.accessToken)
        try store.saveRefreshToken(granted.refreshToken)
        let claims = Self.decodeAccessTokenClaims(granted.accessToken)
        return StoredDesktopSession(
            accessToken: granted.accessToken,
            userId: claims.sub.flatMap(UUID.init(uuidString:)),
            email: claims.email ?? email
        )
    }

    func signOut() async throws {
        // Best-effort server-side revoke; local clear must succeed regardless.
        if let accessToken = try? store.loadAccessToken() {
            try? await Self.revokeSession(
                accessToken: accessToken,
                configuration: configuration
            )
        }
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
        if let refreshTask {
            return try await refreshTask.value
        }
        let task = Task {
            try await refreshSession(refreshToken)
        }
        refreshTask = task
        defer {
            refreshTask = nil
        }
        return try await task.value
    }

    private static func refreshStoredSession(
        refreshToken: String,
        configuration: DesktopAuthConfiguration
    ) async throws -> RefreshTokenResponse {
        let (data, statusCode) = try await postAuthToken(
            grantType: "refresh_token",
            body: RefreshTokenRequest(refreshToken: refreshToken),
            configuration: configuration
        )
        guard (200..<300).contains(statusCode) else {
            throw DesktopAuthRefreshError.refreshFailed(
                statusCode: statusCode,
                bodyPreview: String(data: data.prefix(240), encoding: .utf8)
            )
        }
        return try JSONDecoder().decode(RefreshTokenResponse.self, from: data)
    }

    private static func passwordGrantSession(
        email: String,
        password: String,
        configuration: DesktopAuthConfiguration
    ) async throws -> RefreshTokenResponse {
        let (data, statusCode) = try await postAuthToken(
            grantType: "password",
            body: PasswordGrantRequest(email: email, password: password),
            configuration: configuration
        )
        guard (200..<300).contains(statusCode) else {
            throw DesktopAuthSignInError.signInFailed(
                statusCode: statusCode,
                bodyPreview: String(data: data.prefix(240), encoding: .utf8)
            )
        }
        return try JSONDecoder().decode(RefreshTokenResponse.self, from: data)
    }

    private static func revokeSession(
        accessToken: String,
        configuration: DesktopAuthConfiguration
    ) async throws {
        var request = URLRequest(url: configuration.supabaseURL.appending(path: "auth/v1/logout"))
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue(configuration.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        _ = try await URLSession.shared.data(for: request)
    }

    private static func postAuthToken(
        grantType: String,
        body: some Encodable,
        configuration: DesktopAuthConfiguration
    ) async throws -> (Data, Int) {
        var components = URLComponents(
            url: configuration.supabaseURL.appending(path: "auth/v1/token"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "grant_type", value: grantType)
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
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
        return (data, statusCode)
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

private struct PasswordGrantRequest: Encodable {
    let email: String
    let password: String
}

struct RefreshTokenResponse: Decodable, Sendable, Equatable {
    let accessToken: String
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}

enum DesktopAuthRefreshError: LocalizedError, Equatable {
    case invalidRefreshURL
    case refreshFailed(statusCode: Int, bodyPreview: String?)

    var errorDescription: String? {
        switch self {
        case .invalidRefreshURL:
            return "Saved sign-in could not be refreshed."
        case .refreshFailed:
            return "Saved sign-in expired. Sign in again to upload."
        }
    }
}

enum DesktopAuthSignInError: LocalizedError, Equatable {
    case signInFailed(statusCode: Int, bodyPreview: String?)

    var errorDescription: String? {
        switch self {
        case .signInFailed(let statusCode, let bodyPreview):
            // Keep the server body in the message: RecorderViewModel matches
            // substrings like "exceed_egress_quota" to explain Supabase
            // project-level failures.
            if let bodyPreview, !bodyPreview.isEmpty {
                return "Sign-in was rejected (\(statusCode)): \(bodyPreview)"
            }
            return "Sign-in was rejected (\(statusCode))."
        }
    }
}
