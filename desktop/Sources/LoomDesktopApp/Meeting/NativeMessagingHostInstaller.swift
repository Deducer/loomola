import Foundation

struct NativeMessagingHostInstallResult: Equatable, Sendable {
    let output: String
}

actor NativeMessagingHostInstaller {
    func install(extensionId: String? = nil) async throws -> NativeMessagingHostInstallResult {
        let scriptURL = try Self.installerScriptURL()
        let process = Process()
        let outputPipe = Pipe()
        let trimmedExtensionId = extensionId?.trimmingCharacters(in: .whitespacesAndNewlines)

        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptURL.path] + (trimmedExtensionId?.isEmpty == false ? [trimmedExtensionId!] : [])
        process.standardOutput = outputPipe
        process.standardError = outputPipe
        process.currentDirectoryURL = scriptURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        process.environment = environmentWithDeveloperPath()

        try process.run()
        process.waitUntilExit()

        let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard process.terminationStatus == 0 else {
            throw NativeMessagingHostInstallerError.failed(
                exitCode: process.terminationStatus,
                output: output
            )
        }

        return NativeMessagingHostInstallResult(output: output)
    }

    static func installerScriptURL(
        fileManager: FileManager = .default,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    ) throws -> URL {
        guard let repoRoot = repoRootURL(fileManager: fileManager, currentDirectory: currentDirectory) else {
            throw NativeMessagingHostInstallerError.missingInstaller
        }
        return repoRoot
            .appending(path: "desktop", directoryHint: .isDirectory)
            .appending(path: "scripts", directoryHint: .isDirectory)
            .appending(path: "install-native-messaging-host.sh")
    }

    static func extensionDirectoryURL(
        fileManager: FileManager = .default,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    ) -> URL? {
        repoRootURL(fileManager: fileManager, currentDirectory: currentDirectory)?
            .appending(path: "extension", directoryHint: .isDirectory)
    }

    static func repoRootURL(
        fileManager: FileManager = .default,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    ) -> URL? {
        let current = currentDirectory.standardizedFileURL
        let candidates = [
            current,
            current.deletingLastPathComponent(),
            current.deletingLastPathComponent().deletingLastPathComponent(),
        ]

        for candidate in candidates {
            let script = candidate
                .appending(path: "desktop", directoryHint: .isDirectory)
                .appending(path: "scripts", directoryHint: .isDirectory)
                .appending(path: "install-native-messaging-host.sh")
            let manifest = candidate
                .appending(path: "extension", directoryHint: .isDirectory)
                .appending(path: "manifest.json")
            if fileManager.fileExists(atPath: script.path),
               fileManager.fileExists(atPath: manifest.path) {
                return candidate
            }
        }

        return nil
    }

    private func environmentWithDeveloperPath() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let path = environment["PATH"] ?? ""
        let developerPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        environment["PATH"] = path.isEmpty ? developerPath : "\(developerPath):\(path)"
        return environment
    }
}

enum NativeMessagingHostInstallerError: LocalizedError, Equatable {
    case missingInstaller
    case failed(exitCode: Int32, output: String)

    var errorDescription: String? {
        switch self {
        case .missingInstaller:
            return "Could not find the Chrome bridge installer in this repo checkout."
        case .failed(let exitCode, let output):
            if output.isEmpty {
                return "Chrome bridge installer failed with exit code \(exitCode)."
            }
            return "Chrome bridge installer failed with exit code \(exitCode): \(output)"
        }
    }
}
