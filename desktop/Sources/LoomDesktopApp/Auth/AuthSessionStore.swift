import Foundation
import Security
import Supabase

struct DesktopAuthConfiguration: Sendable {
    let supabaseURL: URL
    let anonKey: String
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

    func loadAccessToken() throws -> String? {
        try load(account: "supabase-access-token")
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
