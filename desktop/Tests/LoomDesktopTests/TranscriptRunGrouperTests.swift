import XCTest
@testable import LoomDesktopApp

final class TranscriptRunGrouperTests: XCTestCase {
    private func bubble(
        _ id: String,
        speaker: String,
        source: LiveTranscriptAudioSource? = nil,
        idx: Int? = nil,
        start: Double,
        end: Double,
        text: String
    ) -> TranscriptDisplayBubble {
        TranscriptDisplayBubble(
            id: id,
            source: source,
            speaker: speaker,
            text: text,
            isInterim: false,
            startSec: start,
            endSec: end,
            speakerIdx: idx
        )
    }

    func testRunsSplitOnSpeakerChange() {
        let runs = TranscriptRunGrouper.runs(from: [
            bubble("a", speaker: "Me", source: .microphone, start: 0, end: 3, text: "Hi"),
            bubble("b", speaker: "Me", source: .microphone, start: 3, end: 6, text: "there"),
            bubble("c", speaker: "Call audio", source: .systemAudio, start: 6, end: 9, text: "Hello"),
        ])
        XCTAssertEqual(runs.map(\.speaker), ["Me", "Call audio"])
        XCTAssertEqual(runs[0].paragraphs.map(\.text), ["Hi", "there"])
        XCTAssertEqual(runs[0].startSec, 0)
    }

    func testSingleSourceProducesOneRun() {
        let runs = TranscriptRunGrouper.runs(from: [
            bubble("a", speaker: "Call audio", source: .systemAudio, start: 0, end: 3, text: "a"),
            bubble("b", speaker: "Call audio", source: .systemAudio, start: 4, end: 7, text: "b"),
        ])
        XCTAssertEqual(runs.count, 1)
        XCTAssertEqual(runs[0].paragraphs.count, 2)
    }

    func testLongSilenceStartsANewRunWithItsOwnTimestamp() {
        let runs = TranscriptRunGrouper.runs(from: [
            bubble("a", speaker: "Gabe", idx: 2, start: 0, end: 3, text: "a"),
            bubble("b", speaker: "Gabe", idx: 2, start: 60, end: 63, text: "b"),
        ])
        XCTAssertEqual(runs.count, 2)
        XCTAssertEqual(runs[1].startSec, 60)
    }

    func testLegacyFullTextSplitsIntoSpeakerRuns() {
        let text = "Ian Cross: Okay. Let's see.\nGabe Masi: Yeah, about the same.\nIan Cross: Cool.\nIan Cross: Well, nice.\nNote without a speaker"
        let bubbles = TranscriptRunGrouper.bubbles(fromFullText: text)
        XCTAssertEqual(bubbles.map(\.speaker), ["Ian Cross", "Gabe Masi", "Ian Cross", "Ian Cross", nil])
        XCTAssertEqual(bubbles[0].text, "Okay. Let's see.")
        let runs = TranscriptRunGrouper.runs(from: bubbles)
        XCTAssertEqual(runs.map(\.speaker), ["Ian Cross", "Gabe Masi", "Ian Cross", nil])
        XCTAssertEqual(runs[2].paragraphs.count, 2)
        XCTAssertFalse(runs[0].hasTiming)
    }

    func testExpandsSingleParagraphWithInlineSpeakers() {
        let blob = TranscriptDisplayBubble(
            id: "p0", source: nil, speaker: nil,
            text: "Ian Cross: Okay.\nGabe Masi: Sure.\nIan Cross: Cool.",
            isInterim: false, startSec: 0, endSec: 0
        )
        let timed = TranscriptDisplayBubble(
            id: "p1", source: nil, speaker: "Speaker 2",
            text: "Line one\nline two", isInterim: false, startSec: 10, endSec: 14, speakerIdx: 2
        )
        let expanded = TranscriptRunGrouper.expandingInlineSpeakerLines([blob, timed])
        XCTAssertEqual(expanded.map(\.speaker), ["Ian Cross", "Gabe Masi", "Ian Cross", "Speaker 2"])
        XCTAssertEqual(expanded.last?.text, "Line one\nline two")
    }

    func testGutterLabelAndColorSlots() {
        let start = ISO8601DateFormatter().date(from: "2026-10-28T19:24:00Z")!
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        utc.locale = Locale(identifier: "en_US_POSIX")
        XCTAssertEqual(TranscriptRunGrouper.gutterLabel(startSec: 125, recordingStart: start, calendar: utc), "7:26")

        let me = TranscriptRunGrouper.runs(from: [bubble("a", speaker: "Me", source: .microphone, start: 0, end: 1, text: "x")])[0]
        let guest = TranscriptRunGrouper.runs(from: [bubble("b", speaker: "Gabe", idx: 3, start: 0, end: 1, text: "x")])[0]
        XCTAssertEqual(TranscriptRunGrouper.colorSlot(for: me), 0)
        XCTAssertEqual(TranscriptRunGrouper.colorSlot(for: guest), 4)

        let namedA = TranscriptRunGrouper.runs(from: [bubble("c", speaker: "Ian Cross", start: 0, end: 0, text: "x")])[0]
        let namedA2 = TranscriptRunGrouper.runs(from: [bubble("d", speaker: "Ian Cross", start: 0, end: 0, text: "y")])[0]
        let namedB = TranscriptRunGrouper.runs(from: [bubble("e", speaker: "Gabe Masi", start: 0, end: 0, text: "z")])[0]
        XCTAssertEqual(TranscriptRunGrouper.colorSlot(for: namedA), TranscriptRunGrouper.colorSlot(for: namedA2))
        XCTAssertTrue((1...5).contains(TranscriptRunGrouper.colorSlot(for: namedB)))
    }

    // MARK: - Live bubbles

    private func liveSegment(
        source: LiveTranscriptAudioSource,
        speaker: Int? = nil,
        start: Double,
        end: Double,
        text: String
    ) -> LiveTranscriptSegment {
        LiveTranscriptSegment(source: source, startSec: start, endSec: end, text: text, words: [], speaker: speaker)
    }

    func testLiveBubblesSplitWhenTheCallVoiceChanges() {
        let bubbles = TranscriptRunGrouper.liveBubbles(
            segments: [
                liveSegment(source: .systemAudio, speaker: 0, start: 0, end: 2, text: "Hi all."),
                liveSegment(source: .systemAudio, speaker: 0, start: 2.5, end: 4, text: "Shall we start?"),
                liveSegment(source: .systemAudio, speaker: 1, start: 4.2, end: 6, text: "Sure."),
                liveSegment(source: .microphone, start: 6.5, end: 8, text: "Sounds good."),
            ],
            interimBySource: [:]
        )
        XCTAssertEqual(bubbles.map(\.speaker), ["Speaker 1", "Speaker 2", "Me"])
        XCTAssertEqual(bubbles[0].text, "Hi all. Shall we start?")
        let runs = TranscriptRunGrouper.runs(from: bubbles)
        XCTAssertEqual(runs.map(\.speaker), ["Speaker 1", "Speaker 2", "Me"])
    }

    func testLiveBubblesKeepCallAudioLabelWithoutDiarization() {
        let bubbles = TranscriptRunGrouper.liveBubbles(
            segments: [liveSegment(source: .systemAudio, start: 0, end: 2, text: "Hello")],
            interimBySource: [.systemAudio: "and", .microphone: "hmm"]
        )
        XCTAssertEqual(bubbles.map(\.speaker), ["Call audio", "Me", "Call audio"])
        XCTAssertEqual(bubbles.map(\.isInterim), [false, true, true])
    }

    func testLiveInterimTrailsUnderTheStreamsLastVoice() {
        let bubbles = TranscriptRunGrouper.liveBubbles(
            segments: [liveSegment(source: .systemAudio, speaker: 2, start: 0, end: 2, text: "Hello")],
            interimBySource: [.systemAudio: "and then"]
        )
        XCTAssertEqual(bubbles.map(\.speaker), ["Speaker 3", "Speaker 3"])
        XCTAssertEqual(TranscriptRunGrouper.runs(from: bubbles).count, 1)
    }

    func testLiveParagraphBreaksAtSentenceEndOnceOverTheCap() {
        // Eight 5-second sentences from one voice with no pauses: the
        // first paragraph closes at the first sentence end past 30 s.
        var segments: [LiveTranscriptSegment] = []
        for i in 0..<8 {
            let start = Double(i) * 5
            segments.append(liveSegment(source: .systemAudio, speaker: 0, start: start, end: start + 4.5, text: "Sentence \(i) here."))
        }
        let bubbles = TranscriptRunGrouper.liveBubbles(segments: segments, interimBySource: [:])
        XCTAssertEqual(bubbles.count, 2)
        XCTAssertEqual(bubbles[0].text.components(separatedBy: ". ").count, 7)
        XCTAssertEqual(bubbles[1].startSec, 35)
        XCTAssertEqual(TranscriptRunGrouper.runs(from: bubbles).count, 1, "same voice stays one run with two paragraphs")
    }

    func testLiveParagraphHardBreaksWithoutPunctuation() {
        let words = Array(repeating: "word", count: 50).joined(separator: " ")
        let segments = (0..<4).map { i in
            liveSegment(source: .systemAudio, speaker: 0, start: Double(i) * 3, end: Double(i) * 3 + 2.5, text: words)
        }
        let bubbles = TranscriptRunGrouper.liveBubbles(segments: segments, interimBySource: [:])
        XCTAssertEqual(bubbles.count, 2)
        XCTAssertEqual(bubbles[0].text.split(separator: " ").count, 150)
    }

    func testLiveCallVoicesGetDistinctColourSlots() {
        let runs = TranscriptRunGrouper.runs(from: [
            bubble("a", speaker: "Speaker 1", source: .systemAudio, start: 0, end: 1, text: "a"),
            bubble("b", speaker: "Speaker 2", source: .systemAudio, start: 1, end: 2, text: "b"),
            bubble("c", speaker: "Call audio", source: .systemAudio, start: 2, end: 3, text: "c"),
            bubble("d", speaker: "Me", source: .microphone, start: 3, end: 4, text: "d"),
        ])
        XCTAssertEqual(runs.count, 4)
        XCTAssertEqual(runs.map(TranscriptRunGrouper.colorSlot(for:)), [1, 2, 1, 0])
    }
}
