import Foundation

struct NativeMeetingMessage: Codable {
    let event: String?
    let source: String?
    let title: String?
    let tabUrl: String?
    let ts: Double?
}

struct NativeMeetingSignal: Codable {
    let event: String
    let source: String
    let title: String?
    let tabUrl: String?
    let ts: Double
    let receivedAt: Double
}

struct NativeHostResponse: Codable {
    let ok: Bool
    let error: String?
}

func readChromeMessage() throws -> Data {
    let input = FileHandle.standardInput
    let lengthData = try input.read(upToCount: 4) ?? Data()
    guard lengthData.count == 4 else {
        throw NativeHostError.missingLengthPrefix
    }
    let length = lengthData.enumerated().reduce(UInt32(0)) { value, pair in
        value | (UInt32(pair.element) << UInt32(pair.offset * 8))
    }
    guard length > 0, length < 1_000_000 else {
        throw NativeHostError.invalidLength
    }
    let payload = try input.read(upToCount: Int(length)) ?? Data()
    guard payload.count == Int(length) else {
        throw NativeHostError.incompletePayload
    }
    return payload
}

func writeChromeMessage(_ response: NativeHostResponse) {
    let data = (try? JSONEncoder().encode(response)) ?? Data(#"{"ok":false}"#.utf8)
    var length = UInt32(data.count).littleEndian
    let lengthData = Data(bytes: &length, count: 4)
    FileHandle.standardOutput.write(lengthData)
    FileHandle.standardOutput.write(data)
}

func signalFileURL() throws -> URL {
    guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
        throw NativeHostError.missingApplicationSupportDirectory
    }
    let directory = base.appending(path: "LoomDesktop", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appending(path: "chrome-meeting-signal.json")
}

func persist(_ message: NativeMeetingMessage) throws {
    guard message.event == "meeting-active" else {
        throw NativeHostError.unsupportedEvent
    }
    guard let source = message.source, ["meet", "teams", "zoom"].contains(source) else {
        throw NativeHostError.unsupportedSource
    }
    let now = Date().timeIntervalSince1970 * 1000
    let signal = NativeMeetingSignal(
        event: "meeting-active",
        source: source,
        title: message.title,
        tabUrl: message.tabUrl,
        ts: message.ts ?? now,
        receivedAt: now
    )
    let data = try JSONEncoder().encode(signal)
    try data.write(to: signalFileURL(), options: [.atomic])
}

do {
    let data = try readChromeMessage()
    let message = try JSONDecoder().decode(NativeMeetingMessage.self, from: data)
    try persist(message)
    writeChromeMessage(NativeHostResponse(ok: true, error: nil))
} catch {
    writeChromeMessage(NativeHostResponse(ok: false, error: String(describing: error)))
}

enum NativeHostError: Error {
    case missingLengthPrefix
    case invalidLength
    case incompletePayload
    case missingApplicationSupportDirectory
    case unsupportedEvent
    case unsupportedSource
}
