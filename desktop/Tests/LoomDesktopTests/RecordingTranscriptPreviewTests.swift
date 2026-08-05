import XCTest
@testable import LoomDesktopApp

final class RecordingTranscriptPreviewTests: XCTestCase {
    func testPreviewGroupsNearbyFinalSegmentsAndKeepsInterimTail() {
        let entries = RecordingTranscriptPreviewBuilder.entries(
            segments: [
                segment(.microphone, start: 0, end: 1, text: "I can hear"),
                segment(.microphone, start: 1.4, end: 2.2, text: "you clearly."),
                segment(.systemAudio, start: 4, end: 5, text: "Great, thanks."),
            ],
            interimBySource: [.systemAudio: "Let's begin with"]
        )

        XCTAssertEqual(entries.count, 3)
        XCTAssertEqual(entries[0].text, "I can hear you clearly.")
        XCTAssertEqual(entries[1].text, "Great, thanks.")
        XCTAssertEqual(entries[2].text, "Let's begin with")
        XCTAssertTrue(entries[2].isInterim)
    }

    func testPreviewKeepsOnlyTheNewestEntries() {
        let entries = RecordingTranscriptPreviewBuilder.entries(
            segments: [
                segment(.microphone, start: 0, end: 1, text: "One."),
                segment(.systemAudio, start: 2, end: 3, text: "Two."),
                segment(.microphone, start: 4, end: 5, text: "Three."),
                segment(.systemAudio, start: 6, end: 7, text: "Four."),
            ],
            interimBySource: [:],
            limit: 2
        )

        XCTAssertEqual(entries.map(\.text), ["Three.", "Four."])
    }

    private func segment(
        _ source: LiveTranscriptAudioSource,
        start: Double,
        end: Double,
        text: String
    ) -> LiveTranscriptSegment {
        LiveTranscriptSegment(
            source: source,
            startSec: start,
            endSec: end,
            text: text,
            words: []
        )
    }
}
