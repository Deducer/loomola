import Foundation
import Security
import Supabase

struct DesktopAuthConfiguration: Sendable {
    let apiBaseURL: URL
    let supabaseURL: URL
    let anonKey: String

    static func fromEnvironment(_ environment: [String: String] = ProcessInfo.processInfo.environment) throws -> DesktopAuthConfiguration {
        let apiBase = environment["LOOM_API_BASE_URL"] ?? "https://loom.dissonance.cloud"
        guard let apiBaseURL = URL(string: apiBase) else {
            throw DesktopConfigurationError.invalidURL("LOOM_API_BASE_URL")
        }
        let supabaseRaw = environment["LOOM_SUPABASE_URL"]
            ?? environment["NEXT_PUBLIC_SUPABASE_URL"]
            ?? environment["SUPABASE_URL"]
        guard let supabaseRaw, let supabaseURL = URL(string: supabaseRaw) else {
            throw DesktopConfigurationError.missingOrInvalid("LOOM_SUPABASE_URL")
        }
        let anonKey = environment["LOOM_SUPABASE_ANON_KEY"]
            ?? environment["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
            ?? environment["SUPABASE_ANON_KEY"]
        guard let anonKey, !anonKey.isEmpty else {
            throw DesktopConfigurationError.missingOrInvalid("LOOM_SUPABASE_ANON_KEY")
        }
        return DesktopAuthConfiguration(apiBaseURL: apiBaseURL, supabaseURL: supabaseURL, anonKey: anonKey)
    }
}

final class AuthSessionStore {
    private let service = "cloud.dissonance.loom.desktop"

    func makeClient(configuration: DesktopAuthConfiguration) -> SupabaseClient {
        SupabaseClient(
            supabaseURL: configuration.supabaseURL,
            supabaseKey: configuration.anonKey
        )
    }

    func saveAccessToken(_ token: String) throws {
        try save(value: token, account: "supabase-access-token")
    }

    func saveRefreshToken(_ token: String) throws {
        try save(value: token, account: "supabase-refresh-token")
    }

    func save(session: Session) throws {
        try saveAccessToken(session.accessToken)
        try saveRefreshToken(session.refreshToken)
    }

    func loadAccessToken() throws -> String? {
        try load(account: "supabase-access-token")
    }

    func loadRefreshToken() throws -> String? {
        try load(account: "supabase-refresh-token")
    }

    func clear() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func save(value: String, account: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)

        var insert = query
        insert[kSecValueData as String] = data
        let status = SecItemAdd(insert as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unhandledStatus(status)
        }
    }

    private func load(account: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.unhandledStatus(status)
        }
        return String(decoding: data, as: UTF8.self)
    }
}

enum KeychainError: Error {
    case unhandledStatus(OSStatus)
}

enum DesktopConfigurationError: LocalizedError, Equatable {
    case invalidURL(String)
    case missingOrInvalid(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let key):
            return "\(key) is not a valid URL."
        case .missingOrInvalid(let key):
            return "\(key) is missing or invalid."
        }
    }
}
