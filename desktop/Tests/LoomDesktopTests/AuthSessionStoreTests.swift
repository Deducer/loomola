import XCTest
@testable import LoomDesktopApp

final class AuthSessionStoreTests: XCTestCase {
    func testDefaultStorageModeIsKeychain() {
        // Production safety: the default initializer must never silently
        // promote to file-based storage based on bundle path or any other
        // heuristic. Keychain only.
        let store = AuthSessionStore()
        XCTAssertEqual(store.storageModeForTesting, .keychain)
    }

    func testStorageModeStaysKeychainEvenWhenBundlePathLooksDevy() {
        // The previous implementation switched to file storage when
        // Bundle.main.bundlePath contained "/.build/" — every dev build hit
        // this path and persisted tokens as plaintext JSON. Hard-confirm the
        // heuristic is gone: there is no path-based mode flip anywhere.
        let store = AuthSessionStore()
        XCTAssertFalse(store.usesFileStoreForTesting)
    }

    func testFileStoreRoundTripsTokensWhenExplicitlyOptedInForTests() throws {
        // The .file mode survives only as a unit-test seam. Production code
        // never constructs the store with .file.
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let fileURL = directory.appending(path: "auth-session.json")
        let store = AuthSessionStore(storageMode: .fileForTesting, fileURL: fileURL)

        try store.saveAccessToken("access")
        try store.saveRefreshToken("refresh")

        XCTAssertEqual(try store.loadAccessToken(), "access")
        XCTAssertEqual(try store.loadRefreshToken(), "refresh")

        try store.clear()
        XCTAssertNil(try store.loadAccessToken())
        XCTAssertNil(try store.loadRefreshToken())
    }
}
