import XCTest
@testable import LoomDesktopApp

final class AuthSessionStoreTests: XCTestCase {
    func testDefaultStorageModeIsFile() {
        // Default flipped from .keychain to .file because macOS Keychain
        // re-prompts for the login password every time the app's binary is
        // re-signed (every install-local-app.sh run). See AuthSessionStore.swift
        // for the full reasoning.
        let store = AuthSessionStore()
        XCTAssertEqual(store.storageModeForTesting, .file)
        XCTAssertTrue(store.usesFileStoreForTesting)
    }

    func testFileStoreRoundTripsTokens() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let fileURL = directory.appending(path: "auth-session.json")
        let store = AuthSessionStore(storageMode: .file, fileURL: fileURL)

        try store.saveAccessToken("access")
        try store.saveRefreshToken("refresh")

        XCTAssertEqual(try store.loadAccessToken(), "access")
        XCTAssertEqual(try store.loadRefreshToken(), "refresh")

        try store.clear()
        XCTAssertNil(try store.loadAccessToken())
        XCTAssertNil(try store.loadRefreshToken())
    }

    func testDesktopAuthServiceDecodesAccessTokenClaims() throws {
        let payload = #"{"sub":"612bc4b4-2a6c-4721-8820-f256e4eb0ef6","email":"ian@example.com","exp":1893456000}"#
        let token = [
            "header",
            Self.base64URL(payload.data(using: .utf8)!),
            "signature"
        ].joined(separator: ".")

        let claims = DesktopAuthService.decodeAccessTokenClaims(token)

        XCTAssertEqual(claims.sub, "612bc4b4-2a6c-4721-8820-f256e4eb0ef6")
        XCTAssertEqual(claims.email, "ian@example.com")
        XCTAssertEqual(claims.exp, 1893456000)
    }

    func testAccessTokenClaimsTreatsNearlyExpiredTokensAsExpired() {
        let now = Date(timeIntervalSince1970: 1_000)

        XCTAssertTrue(AccessTokenClaims(exp: 1_030).isExpired(now: now, leeway: 60))
        XCTAssertFalse(AccessTokenClaims(exp: 1_120).isExpired(now: now, leeway: 60))
    }

    private static func base64URL(_ data: Data) -> String {
        data
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
