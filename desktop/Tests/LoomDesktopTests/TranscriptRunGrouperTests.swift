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
}
