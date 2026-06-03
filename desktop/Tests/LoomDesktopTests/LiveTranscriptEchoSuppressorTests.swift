import XCTest
@testable import LoomDesktopApp

final class LiveTranscriptEchoSuppressorTests: XCTestCase {
    func testDeepgramBadServerResponseIsActionableAndNotRetried() {
        let url = URL(string: "wss://api.deepgram.com/v1/listen?model=nova-3")!
        let error = NSError(
            domain: NSURLErrorDomain,
            code: NSURLErrorBadServerResponse,
            userInfo: [
                NSURLErrorFailingURLErrorKey: url,
                NSLocalizedDescriptionKey: "There was a bad response from the server.",
            ]
        )

        XCTAssertEqual(
            LiveTranscriptionTransportFailure.message(for: error),
            "Deepgram rejected live transcription. Check Deepgram credits or model access."
        )
        XCTAssertFalse(LiveTranscriptionTransportFailure.isRetryable(error))
    }

    func testSuppressesRemoteSpeechEchoedIntoMicrophone() {
        let segments = [
            segment(source: .systemAudio, start: 0, text: "Oh, there you go. Really?"),
            segment(source: .microphone, start: 0.2, text: "Oh, there we go. Really?"),
            segment(source: .systemAudio, start: 3, text: "Let's see. I was testing because I'm on the back of the house."),
            segment(source: .microphone, start: 3.1, text: "Let's see. I was testing because I'm on the back of the house."),
        ]

        XCTAssertEqual(
            TranscriptEchoSuppressor.filtered(segments).map(\.text),
            [
                "Oh, there you go. Really?",
                "Let's see. I was testing because I'm on the back of the house.",
            ]
        )
    }

    func testKeepsDistinctMicrophoneSpeechNearSystemAudio() {
        let segments = [
            segment(source: .systemAudio, start: 10, text: "Gotcha. Or we can turn our video off if that helps."),
            segment(source: .microphone, start: 10.3, text: "What's up? Let's test it once everyone is here."),
        ]

        XCTAssertEqual(
            TranscriptEchoSuppressor.filtered(segments).map(\.text),
            [
                "Gotcha. Or we can turn our video off if that helps.",
                "What's up? Let's test it once everyone is here.",
            ]
        )
    }

    func testSuppressesGarbledRemoteSpeechLeakingIntoMicrophone() {
        let segments = [
            segment(
                source: .systemAudio,
                start: 30,
                text: "Everyone is have basically, like, I like, everyone's like, it takes weeks."
            ),
            segment(
                source: .microphone,
                start: 31.1,
                text: "And, like, everyone has had basically, like, I like, everyone's gonna take weeks."
            ),
        ]

        XCTAssertEqual(
            TranscriptEchoSuppressor.filtered(segments).map(\.text),
            [
                "Everyone is have basically, like, I like, everyone's like, it takes weeks.",
            ]
        )
    }

    func testTrimsEchoedRemotePrefixWhileKeepingLocalSpeech() {
        let segments = [
            segment(
                source: .systemAudio,
                start: 45,
                text: "Say you when you say impactful, you mean, like, they can fuck you up?"
            ),
            segment(
                source: .microphone,
                start: 45.2,
                text: "Say you when you say impactful, you mean, like, Well, I don't know. I know they can really mess some stuff up."
            ),
        ]

        XCTAssertEqual(
            TranscriptEchoSuppressor.filtered(segments).map(\.text),
            [
                "Say you when you say impactful, you mean, like, they can fuck you up?",
                "Well, I don't know. I know they can really mess some stuff up.",
            ]
        )
    }

    func testKeepsNearDuplicateLocalResponseAfterRemoteSpeakerFinishes() {
        let segments = [
            segment(source: .systemAudio, start: 60, text: "I think it would be seven days free trial."),
            segment(source: .microphone, start: 63, text: "I think we do seven days free trial."),
        ]

        XCTAssertEqual(
            TranscriptEchoSuppressor.filtered(segments).map(\.text),
            [
                "I think it would be seven days free trial.",
                "I think we do seven days free trial.",
            ]
        )
    }

    func testSplitsSentenceLikeGroupsBeforeSuppressingEcho() {
        let mic = segment(
            source: .microphone,
            start: 20,
            text: "Good. It's time for summer. Yeah. Exactly."
        )
        let system = segment(source: .systemAudio, start: 22, text: "Yeah. Exactly.")
        let split = TranscriptEchoSuppressor.split(mic) + TranscriptEchoSuppressor.split(system)

        XCTAssertEqual(
            TranscriptEchoSuppressor.filtered(split).map(\.text),
            ["Good.", "It's time for summer.", "Yeah.", "Exactly."]
        )
    }

    private func segment(
        source: LiveTranscriptAudioSource,
        start: Double,
        text: String
    ) -> LiveTranscriptSegment {
        let words = text.split(separator: " ").enumerated().map { index, word in
            LiveTranscriptWord(
                word: String(word),
                start: start + Double(index) * 0.25,
                end: start + Double(index) * 0.25 + 0.18,
                confidence: 0.95,
                source: source
            )
        }
        return LiveTranscriptSegment(
            source: source,
            startSec: start,
            endSec: words.last?.end ?? start,
            text: text,
            words: words
        )
    }
}
