import AVFoundation
import Foundation
import OSLog

private let liveTranscriptLog = Logger(
    subsystem: "cloud.dissonance.loom.desktop",
    category: "live-transcript"
)

enum LiveTranscriptAudioSource: String, CaseIterable, Sendable, Hashable {
    case microphone
    case systemAudio

    var displayName: String {
        switch self {
        case .microphone: return "Me"
        case .systemAudio: return "Call audio"
        }
    }

    var speakerIndex: Int {
        switch self {
        case .microphone: return 0
        case .systemAudio: return 1
        }
    }
}

enum LiveTranscriptionStatus: Equatable {
    case disabled
    case idle
    case connecting
    case streaming
    case unavailable(String)

    var label: String {
        switch self {
        case .disabled: return "Live transcription off"
        case .idle: return "Live transcript ready"
        case .connecting: return "Connecting live transcript"
        case .streaming: return "Live transcript"
        case .unavailable: return "Live transcript unavailable"
        }
    }
}

struct LiveTranscriptWord: Equatable, Sendable {
    let word: String
    let start: Double
    let end: Double
    let confidence: Double?
    let source: LiveTranscriptAudioSource
}

struct LiveTranscriptSegment: Identifiable, Equatable, Sendable {
    let id = UUID()
    let source: LiveTranscriptAudioSource
    let startSec: Double
    let endSec: Double
    let text: String
    let words: [LiveTranscriptWord]
}

@MainActor
final class LiveTranscriptionCoordinator: ObservableObject {
    @Published private(set) var status: LiveTranscriptionStatus = .idle
    @Published private(set) var segments: [LiveTranscriptSegment] = []
    @Published private(set) var interimBySource: [LiveTranscriptAudioSource: String] = [:]

    private var streams: [LiveTranscriptAudioSource: LiveTranscriptionStream] = [:]
    private var enabled = true

    var hasTranscriptText: Bool {
        !segments.isEmpty ||
            interimBySource.values.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    func start(
        backend: BackendClient,
        includeMic: Bool,
        includeSystemAudio: Bool,
        enabled: Bool
    ) {
        reset()
        self.enabled = enabled
        guard enabled else {
            status = .disabled
            return
        }

        let sources: [LiveTranscriptAudioSource] = [
            includeMic ? .microphone : nil,
            includeSystemAudio ? .systemAudio : nil,
        ].compactMap { $0 }

        guard !sources.isEmpty else {
            status = .disabled
            return
        }

        status = .connecting
        for source in sources {
            streams[source] = LiveTranscriptionStream(
                source: source,
                backend: backend,
                onResult: { [weak self] result in
                    Task { @MainActor in
                        self?.apply(result)
                    }
                },
                onState: { [weak self] state in
                    Task { @MainActor in
                        self?.apply(source: source, state: state)
                    }
                }
            )
        }
    }

    func append(buffer: AVAudioPCMBuffer, source: LiveTranscriptAudioSource) {
        guard enabled, let stream = streams[source] else { return }
        stream.append(buffer)
    }

    func pause() {
        guard enabled else { return }
        for stream in streams.values {
            stream.sendKeepAlive()
        }
    }

    func resume() {
        guard enabled else { return }
        status = streams.isEmpty ? .idle : .streaming
    }

    func snapshot(includeInterim: Bool = true) -> LiveTranscriptSnapshot {
        var ordered = segments.sorted {
            if $0.startSec == $1.startSec {
                return $0.source.speakerIndex < $1.source.speakerIndex
            }
            return $0.startSec < $1.startSec
        }

        if includeInterim {
            for source in LiveTranscriptAudioSource.allCases {
                guard let interim = interimBySource[source]?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !interim.isEmpty
                else { continue }
                ordered.append(
                    LiveTranscriptSegment(
                        source: source,
                        startSec: ordered.last?.endSec ?? 0,
                        endSec: ordered.last?.endSec ?? 0,
                        text: interim,
                        words: []
                    )
                )
            }
        }

        let fullText = ordered
            .map { "\($0.source.displayName): \($0.text)" }
            .joined(separator: "\n\n")
        let words = ordered.flatMap { segment in
            segment.words.map {
                LiveTranscriptSnapshot.Word(
                    word: $0.word,
                    start: $0.start,
                    end: $0.end,
                    confidence: $0.confidence,
                    speaker: $0.source.speakerIndex
                )
            }
        }

        return LiveTranscriptSnapshot(
            fullText: fullText,
            language: "en",
            providerRequestId: streams.values.compactMap(\.requestId).first,
            words: words
        )
    }

    func persistSnapshot(mediaId: String, backend: BackendClient) async -> Bool {
        let snapshot = snapshot(includeInterim: true)
        guard !snapshot.fullText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return false
        }
        do {
            try await backend.persistLiveTranscript(mediaId: mediaId, snapshot: snapshot)
            return true
        } catch {
            liveTranscriptLog.error("live transcript persist failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    func finishAndSnapshot() async -> LiveTranscriptSnapshot {
        for stream in streams.values {
            stream.finalize()
        }
        try? await Task.sleep(nanoseconds: 900_000_000)
        let result = snapshot(includeInterim: true)
        stop()
        return result
    }

    func stop() {
        for stream in streams.values {
            stream.close()
        }
        streams = [:]
        interimBySource = [:]
        status = enabled ? .idle : .disabled
    }

    func reset() {
        stop()
        segments = []
        interimBySource = [:]
        status = .idle
    }

    private func apply(_ result: LiveTranscriptionResult) {
        switch result {
        case .final(let segment):
            guard !segment.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            interimBySource[segment.source] = nil
            segments.append(segment)
            segments.sort {
                if $0.startSec == $1.startSec {
                    return $0.source.speakerIndex < $1.source.speakerIndex
                }
                return $0.startSec < $1.startSec
            }
            status = .streaming
        case .interim(let source, let text):
            interimBySource[source] = text.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            status = .streaming
        }
    }

    private func apply(source: LiveTranscriptAudioSource, state: LiveTranscriptionStreamState) {
        switch state {
        case .connecting:
            if status != .streaming { status = .connecting }
        case .streaming:
            status = .streaming
        case .failed(let message):
            liveTranscriptLog.error("live transcript stream failed source=\(source.rawValue, privacy: .public): \(message, privacy: .public)")
            if segments.isEmpty {
                status = .unavailable(message)
            }
        case .closed:
            break
        }
    }
}

private enum LiveTranscriptionResult: Sendable {
    case final(LiveTranscriptSegment)
    case interim(LiveTranscriptAudioSource, String)
}

private enum LiveTranscriptionStreamState: Sendable {
    case connecting
    case streaming
    case failed(String)
    case closed
}

private final class LiveTranscriptionStream: @unchecked Sendable {
    let source: LiveTranscriptAudioSource
    private let backend: BackendClient
    private let onResult: @Sendable (LiveTranscriptionResult) -> Void
    private let onState: @Sendable (LiveTranscriptionStreamState) -> Void
    private let queue: DispatchQueue
    private var webSocket: URLSessionWebSocketTask?
    private var opening = false
    private var closing = false
    private var failedMessage: String?
    private var sampleRate: Int?
    private var pendingAudio: [Data] = []
    private var keepAliveTimer: DispatchSourceTimer?
    private(set) var requestId: String?

    init(
        source: LiveTranscriptAudioSource,
        backend: BackendClient,
        onResult: @escaping @Sendable (LiveTranscriptionResult) -> Void,
        onState: @escaping @Sendable (LiveTranscriptionStreamState) -> Void
    ) {
        self.source = source
        self.backend = backend
        self.onResult = onResult
        self.onState = onState
        self.queue = DispatchQueue(
            label: "cloud.dissonance.loom.desktop.live-transcript.\(source.rawValue)"
        )
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        guard failedMessage == nil else { return }
        guard let packet = Linear16Packet(buffer: buffer), !packet.data.isEmpty else {
            return
        }
        queue.async { [weak self] in
            guard let self else { return }
            if self.sampleRate == nil {
                self.sampleRate = packet.sampleRate
            }
            guard self.sampleRate == packet.sampleRate else {
                liveTranscriptLog.error(
                    "sample rate changed mid-stream source=\(self.source.rawValue, privacy: .public)"
                )
                return
            }
            self.pendingAudio.append(packet.data)
            if self.pendingAudio.count > 120 {
                self.pendingAudio.removeFirst(self.pendingAudio.count - 120)
            }
            self.openIfNeeded()
            self.flushPendingAudio()
        }
    }

    func sendKeepAlive() {
        queue.async { [weak self] in
            self?.sendText(#"{"type":"KeepAlive"}"#)
        }
    }

    func finalize() {
        queue.async { [weak self] in
            self?.sendText(#"{"type":"Finalize"}"#)
        }
    }

    func close() {
        queue.async { [weak self] in
            guard let self else { return }
            self.sendText(#"{"type":"CloseStream"}"#)
            self.closing = true
            self.keepAliveTimer?.cancel()
            self.keepAliveTimer = nil
            self.webSocket?.cancel(with: .normalClosure, reason: nil)
            self.webSocket = nil
            self.pendingAudio = []
            self.opening = false
            self.onState(.closed)
        }
    }

    private func openIfNeeded() {
        guard failedMessage == nil, webSocket == nil, !opening, let sampleRate else { return }
        opening = true
        onState(.connecting)
        Task { [weak self] in
            guard let self else { return }
            do {
                let token = try await backend.createLiveTranscriptionToken()
                self.queue.async {
                    self.openWebSocket(token: token.accessToken, sampleRate: sampleRate)
                }
            } catch {
                self.queue.async {
                    self.opening = false
                    self.pendingAudio = []
                    let message = Self.startFailureMessage(for: error)
                    self.failedMessage = message
                    self.onState(.failed(message))
                }
            }
        }
    }

    private static func startFailureMessage(for error: Error) -> String {
        if let backendError = error as? BackendClientError {
            switch backendError {
            case .badStatus(404, let path, _),
                 .serviceUnavailable(let path, 404):
                if path == "/api/transcribe/live-token" {
                    return "Live transcription is not available on this backend yet."
                }
            case .badStatus(401, _, _),
                 .badStatus(403, _, _):
                return "Sign in again to start live transcription."
            default:
                break
            }
        }
        return "Could not start Deepgram live transcription."
    }

    private func openWebSocket(token: String, sampleRate: Int) {
        var components = URLComponents(string: "wss://api.deepgram.com/v1/listen")!
        components.queryItems = [
            URLQueryItem(name: "model", value: "nova-3"),
            URLQueryItem(name: "interim_results", value: "true"),
            URLQueryItem(name: "endpointing", value: "400"),
            URLQueryItem(name: "punctuate", value: "true"),
            URLQueryItem(name: "smart_format", value: "true"),
            URLQueryItem(name: "encoding", value: "linear16"),
            URLQueryItem(name: "sample_rate", value: String(sampleRate)),
            URLQueryItem(name: "channels", value: "1"),
            URLQueryItem(name: "tag", value: "loomola-\(source.rawValue)")
        ]
        guard let url = components.url else {
            opening = false
            onState(.failed("Could not build Deepgram URL"))
            return
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let task = URLSession.shared.webSocketTask(with: request)
        webSocket = task
        opening = false
        closing = false
        task.resume()
        startKeepAlive()
        receiveNext(on: task)
        flushPendingAudio()
        onState(.streaming)
    }

    private func startKeepAlive() {
        keepAliveTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 3, repeating: 3)
        timer.setEventHandler { [weak self] in
            self?.sendText(#"{"type":"KeepAlive"}"#)
        }
        timer.resume()
        keepAliveTimer = timer
    }

    private func flushPendingAudio() {
        guard let webSocket else { return }
        let chunks = pendingAudio
        pendingAudio = []
        for chunk in chunks {
            webSocket.send(.data(chunk)) { [weak self] error in
                guard let error else { return }
                self?.queue.async {
                    self?.handleTransportFailure(error, requeue: chunk)
                }
            }
        }
    }

    private func sendText(_ text: String) {
        guard let webSocket else { return }
        webSocket.send(.string(text)) { [weak self] error in
            guard let error else { return }
            self?.queue.async {
                self?.handleTransportFailure(error)
            }
        }
    }

    private func receiveNext(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard self.webSocket === task else { return }
                switch result {
                case .success(let message):
                    self.handle(message)
                    self.receiveNext(on: task)
                case .failure(let error):
                    if self.webSocket === task {
                        self.handleTransportFailure(error)
                    }
                }
            }
        }
    }

    private func handleTransportFailure(_ error: Error, requeue chunk: Data? = nil) {
        guard !closing else { return }
        if let chunk {
            pendingAudio.insert(chunk, at: 0)
            if pendingAudio.count > 120 {
                pendingAudio.removeFirst(pendingAudio.count - 120)
            }
        }
        keepAliveTimer?.cancel()
        keepAliveTimer = nil
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        opening = false
        onState(.failed(error.localizedDescription))
        openIfNeeded()
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data?
        switch message {
        case .data(let value):
            data = value
        case .string(let value):
            data = value.data(using: .utf8)
        @unknown default:
            data = nil
        }
        guard let data,
              let event = try? JSONDecoder().decode(DeepgramLiveEvent.self, from: data)
        else { return }

        if event.type == "Metadata" {
            requestId = event.requestId
            return
        }

        guard event.type == "Results",
              let alternative = event.channel?.alternatives.first,
              let transcript = alternative.transcript?.trimmingCharacters(in: .whitespacesAndNewlines)
        else { return }

        if event.isFinal == true {
            let words = (alternative.words ?? []).compactMap { word -> LiveTranscriptWord? in
                let text = word.punctuatedWord ?? word.word
                guard !text.isEmpty else { return nil }
                return LiveTranscriptWord(
                    word: text,
                    start: word.start,
                    end: word.end,
                    confidence: word.confidence,
                    source: source
                )
            }
            let start = words.first?.start ?? event.start ?? 0
            let end = words.last?.end ?? ((event.start ?? 0) + (event.duration ?? 0))
            onResult(
                .final(
                    LiveTranscriptSegment(
                        source: source,
                        startSec: start,
                        endSec: end,
                        text: transcript,
                        words: words
                    )
                )
            )
        } else {
            onResult(.interim(source, transcript))
        }
    }
}

private struct DeepgramLiveEvent: Decodable {
    let type: String?
    let start: Double?
    let duration: Double?
    let isFinal: Bool?
    let speechFinal: Bool?
    let channel: DeepgramLiveChannel?
    let requestId: String?

    enum CodingKeys: String, CodingKey {
        case type
        case start
        case duration
        case isFinal = "is_final"
        case speechFinal = "speech_final"
        case channel
        case requestId = "request_id"
    }
}

private struct DeepgramLiveChannel: Decodable {
    let alternatives: [DeepgramLiveAlternative]
}

private struct DeepgramLiveAlternative: Decodable {
    let transcript: String?
    let words: [DeepgramLiveWord]?
}

private struct DeepgramLiveWord: Decodable {
    let word: String
    let start: Double
    let end: Double
    let confidence: Double?
    let punctuatedWord: String?

    enum CodingKeys: String, CodingKey {
        case word
        case start
        case end
        case confidence
        case punctuatedWord = "punctuated_word"
    }
}

private struct Linear16Packet {
    let data: Data
    let sampleRate: Int

    init?(buffer: AVAudioPCMBuffer) {
        let frameCount = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        guard frameCount > 0, channelCount > 0 else { return nil }
        sampleRate = max(8_000, Int(buffer.format.sampleRate.rounded()))
        data = Self.makeData(buffer: buffer, frameCount: frameCount, channelCount: channelCount)
    }

    private static func makeData(
        buffer: AVAudioPCMBuffer,
        frameCount: Int,
        channelCount: Int
    ) -> Data {
        switch buffer.format.commonFormat {
        case .pcmFormatFloat32:
            return makeFloat32Data(
                buffer: buffer,
                frameCount: frameCount,
                channelCount: channelCount
            )
        case .pcmFormatInt16:
            return makeInt16Data(
                buffer: buffer,
                frameCount: frameCount,
                channelCount: channelCount
            )
        default:
            return Data()
        }
    }

    private static func makeFloat32Data(
        buffer: AVAudioPCMBuffer,
        frameCount: Int,
        channelCount: Int
    ) -> Data {
        var data = Data(capacity: frameCount * 2)
        guard let channelData = buffer.floatChannelData else { return data }

        for frame in 0..<frameCount {
            var mixed: Float = 0
            if buffer.format.isInterleaved {
                let interleaved = channelData[0]
                for channel in 0..<channelCount {
                    mixed += interleaved[frame * channelCount + channel]
                }
            } else {
                for channel in 0..<channelCount {
                    mixed += channelData[channel][frame]
                }
            }
            appendSample(Float(mixed / Float(channelCount)), to: &data)
        }
        return data
    }

    private static func makeInt16Data(
        buffer: AVAudioPCMBuffer,
        frameCount: Int,
        channelCount: Int
    ) -> Data {
        var data = Data(capacity: frameCount * 2)
        guard let channelData = buffer.int16ChannelData else { return data }

        for frame in 0..<frameCount {
            var mixed: Int = 0
            if buffer.format.isInterleaved {
                let interleaved = channelData[0]
                for channel in 0..<channelCount {
                    mixed += Int(interleaved[frame * channelCount + channel])
                }
            } else {
                for channel in 0..<channelCount {
                    mixed += Int(channelData[channel][frame])
                }
            }
            var sample = Int16(
                max(Int(Int16.min), min(Int(Int16.max), mixed / channelCount))
            ).littleEndian
            withUnsafeBytes(of: &sample) { data.append(contentsOf: $0) }
        }
        return data
    }

    private static func appendSample(_ value: Float, to data: inout Data) {
        let clamped = max(-1, min(1, value))
        var sample = Int16(clamped * Float(Int16.max)).littleEndian
        withUnsafeBytes(of: &sample) { data.append(contentsOf: $0) }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
