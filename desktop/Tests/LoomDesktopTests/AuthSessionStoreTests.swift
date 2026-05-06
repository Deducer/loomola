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
}
