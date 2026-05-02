import XCTest
@testable import LoomDesktopApp

final class NativeMessagingHostInstallerTests: XCTestCase {
    func testFindsRepoRootFromDesktopDirectory() throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appending(path: "loom-native-host-\(UUID().uuidString)")
        let desktopScripts = root
            .appending(path: "desktop", directoryHint: .isDirectory)
            .appending(path: "scripts", directoryHint: .isDirectory)
        let extensionDirectory = root.appending(path: "extension", directoryHint: .isDirectory)
        try fileManager.createDirectory(at: desktopScripts, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: extensionDirectory, withIntermediateDirectories: true)
        try Data().write(to: desktopScripts.appending(path: "install-native-messaging-host.sh"))
        try Data().write(to: extensionDirectory.appending(path: "manifest.json"))
        defer { try? fileManager.removeItem(at: root) }

        let repoRoot = NativeMessagingHostInstaller.repoRootURL(
            fileManager: fileManager,
            currentDirectory: root.appending(path: "desktop", directoryHint: .isDirectory)
        )

        XCTAssertEqual(repoRoot?.standardizedFileURL.path, root.standardizedFileURL.path)
    }
}
