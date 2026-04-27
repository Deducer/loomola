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
}
