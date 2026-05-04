import XCTest
@testable import LoomDesktopApp

final class DesktopConfigurationTests: XCTestCase {
    func testConfigurationLoadsFromEnvironment() throws {
        let config = try DesktopAuthConfiguration.fromEnvironment([
            "LOOM_API_BASE_URL": "https://loom.dissonance.cloud",
            "LOOM_SUPABASE_URL": "https://example.supabase.co",
            "LOOM_SUPABASE_ANON_KEY": "anon"
        ])

        XCTAssertEqual(config.apiBaseURL.absoluteString, "https://loom.dissonance.cloud")
        XCTAssertEqual(config.supabaseURL.absoluteString, "https://example.supabase.co")
        XCTAssertEqual(config.anonKey, "anon")
    }

    func testConfigurationDefaultsAPIBaseURL() throws {
        let config = try DesktopAuthConfiguration.fromEnvironment([
            "LOOM_SUPABASE_URL": "https://example.supabase.co",
            "LOOM_SUPABASE_ANON_KEY": "anon"
        ])

        XCTAssertEqual(config.apiBaseURL.absoluteString, "https://loom.dissonance.cloud")
    }

    func testConfigurationCanUseWebAppEnvironmentNames() throws {
        let config = try DesktopAuthConfiguration.fromEnvironment([
            "NEXT_PUBLIC_SUPABASE_URL": "https://example.supabase.co",
            "NEXT_PUBLIC_SUPABASE_ANON_KEY": "anon",
            "NEXT_PUBLIC_APP_URL": "https://loom.dissonance.cloud"
        ])

        XCTAssertEqual(config.apiBaseURL.absoluteString, "https://loom.dissonance.cloud")
        XCTAssertEqual(config.supabaseURL.absoluteString, "https://example.supabase.co")
        XCTAssertEqual(config.anonKey, "anon")
    }

    func testConfigurationLoadsFromBundledPlistWhenEnvironmentIsMissing() throws {
        let fileManager = FileManager.default
        let bundleURL = fileManager.temporaryDirectory
            .appending(path: "LoomDesktopConfig-\(UUID().uuidString).bundle", directoryHint: .isDirectory)
        try fileManager.createDirectory(at: bundleURL, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: bundleURL) }

        let plistURL = bundleURL.appending(path: "DesktopConfig.plist")
        let plist: [String: String] = [
            "LOOM_API_BASE_URL": "https://loom.dissonance.cloud",
            "LOOM_SUPABASE_URL": "https://bundled.supabase.co",
            "LOOM_SUPABASE_ANON_KEY": "bundled-anon"
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: plistURL)

        let bundle = try XCTUnwrap(Bundle(url: bundleURL))
        let config = try DesktopAuthConfiguration.fromEnvironment([:], bundle: bundle)

        XCTAssertEqual(config.apiBaseURL.absoluteString, "https://loom.dissonance.cloud")
        XCTAssertEqual(config.supabaseURL.absoluteString, "https://bundled.supabase.co")
        XCTAssertEqual(config.anonKey, "bundled-anon")
    }

    func testEnvironmentOverridesBundledPlist() throws {
        let fileManager = FileManager.default
        let bundleURL = fileManager.temporaryDirectory
            .appending(path: "LoomDesktopConfig-\(UUID().uuidString).bundle", directoryHint: .isDirectory)
        try fileManager.createDirectory(at: bundleURL, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: bundleURL) }

        let plistURL = bundleURL.appending(path: "DesktopConfig.plist")
        let plist: [String: String] = [
            "LOOM_SUPABASE_URL": "https://bundled.supabase.co",
            "LOOM_SUPABASE_ANON_KEY": "bundled-anon"
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: plistURL)

        let bundle = try XCTUnwrap(Bundle(url: bundleURL))
        let config = try DesktopAuthConfiguration.fromEnvironment([
            "LOOM_SUPABASE_URL": "https://env.supabase.co",
            "LOOM_SUPABASE_ANON_KEY": "env-anon"
        ], bundle: bundle)

        XCTAssertEqual(config.supabaseURL.absoluteString, "https://env.supabase.co")
        XCTAssertEqual(config.anonKey, "env-anon")
    }
}
