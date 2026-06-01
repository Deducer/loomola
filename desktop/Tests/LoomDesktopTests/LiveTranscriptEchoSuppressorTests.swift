import XCTest
@testable import LoomDesktopApp

final class LiveTranscriptEchoSuppressorTests: XCTestCase {
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
