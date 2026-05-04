import Foundation
import Security
import Supabase

enum AuthSessionStorageMode: Equatable {
    case keychain
    /// Test seam only — production code must never construct the store with
    /// this mode. Persists tokens as plaintext JSON at the supplied fileURL.
    case fileForTesting
}

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
    private let storageMode: AuthSessionStorageMode
    private let fileURL: URL

    init(
        storageMode: AuthSessionStorageMode = .keychain,
        fileURL: URL = AuthSessionStore.defaultFileURL()
    ) {
        self.storageMode = storageMode
        self.fileURL = fileURL
    }

    /// Test-only accessor for the storage mode. Production code should not
    /// branch on this — the production answer is always Keychain.
    var storageModeForTesting: AuthSessionStorageMode { storageMode }

    /// Test-only accessor; mirrors the internal usesFileStore predicate.
    var usesFileStoreForTesting: Bool { usesFileStore }

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
        if usesFileStore {
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func save(value: String, account: String) throws {
        if usesFileStore {
            try saveToFile(value: value, account: account)
            return
        }
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
        if usesFileStore {
            let tokens = try loadFileTokens()
            if account == "supabase-access-token" { return tokens.accessToken }
            if account == "supabase-refresh-token" { return tokens.refreshToken }
            return nil
        }
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

    private var usesFileStore: Bool {
        storageMode == .fileForTesting
    }

    private func saveToFile(value: String, account: String) throws {
        var tokens = try loadFileTokens()
        if account == "supabase-access-token" {
            tokens.accessToken = value
        } else if account == "supabase-refresh-token" {
            tokens.refreshToken = value
        }
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try JSONEncoder().encode(tokens).write(to: fileURL, options: [.atomic])
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: fileURL.path
        )
    }

    private func loadFileTokens() throws -> StoredAuthTokens {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return StoredAuthTokens()
        }
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode(StoredAuthTokens.self, from: data)
    }

    private static func defaultFileURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appending(path: "Library/Application Support")
        return base
            .appending(path: "LoomDesktop", directoryHint: .isDirectory)
            .appending(path: "auth-session.json")
    }
}

private struct StoredAuthTokens: Codable {
    var accessToken: String?
    var refreshToken: String?
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
