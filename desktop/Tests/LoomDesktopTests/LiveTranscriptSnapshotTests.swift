import AppKit
import XCTest
@testable import LoomDesktopApp

@MainActor
final class LiveTranscriptSnapshotTests: XCTestCase {
    private func segment(
        source: LiveTranscriptAudioSource,
        start: Double,
        text: String,
        speaker: Int? = nil
    ) -> LiveTranscriptSegment {
        let words = text.split(separator: " ").enumerated().map { index, word in
            LiveTranscriptWord(
                word: String(word),
                start: start + Double(index) * 0.3,
                end: start + Double(index) * 0.3 + 0.2,
                confidence: 0.9,
                source: source,
                speaker: speaker
            )
        }
        return LiveTranscriptSegment(
            source: source,
            startSec: start,
            endSec: words.last?.end ?? start,
            text: text,
            words: words,
            speaker: speaker
        )
    }

    func testSnapshotPersistsMicAsZeroAndEachCallVoiceFromOne() {
        let coordinator = LiveTranscriptionCoordinator()
        coordinator.apply(.final(segment(source: .microphone, start: 0, text: "Hi there.")))
        coordinator.apply(.final(segment(source: .systemAudio, start: 2, text: "Hello.", speaker: 0)))
        coordinator.apply(.final(segment(source: .systemAudio, start: 4, text: "Morning.", speaker: 1)))
        coordinator.apply(.interim(.systemAudio, "and so"))

        let snapshot = coordinator.snapshot(includeInterim: true)
        XCTAssertEqual(
            snapshot.fullText,
            "Me: Hi there.\n\nSpeaker 1: Hello.\n\nSpeaker 2: Morning.\n\nSpeaker 2: and so",
            "interim text stays under the call stream's last voice"
        )
        XCTAssertEqual(snapshot.words.map(\.speaker), [0, 0, 1, 2])
    }

    func testSnapshotKeepsCallAudioLabelWhenNothingWasDiarized() {
        let coordinator = LiveTranscriptionCoordinator()
        coordinator.apply(.final(segment(source: .systemAudio, start: 0, text: "Hello.")))
        coordinator.apply(.interim(.systemAudio, "and"))
        let snapshot = coordinator.snapshot(includeInterim: true)
        XCTAssertEqual(snapshot.fullText, "Call audio: Hello.\n\nCall audio: and")
        XCTAssertEqual(snapshot.words.map(\.speaker), [1])
    }

    // MARK: - Reconnect slot rebase

    func testSlotsAfterAReconnectNeverReuseAnEarlierSpeakerNumber() {
        var slots = LiveSpeakerSlotRebase()
        slots.beginConnection()
        XCTAssertEqual(slots.map(0), 0)
        XCTAssertEqual(slots.map(1), 1)
        XCTAssertNil(slots.map(nil))

        slots.beginConnection() // socket dropped and reopened
        XCTAssertEqual(slots.map(0), 2, "Deepgram's new slot 0 is a fresh voice, not Speaker 1 again")
        XCTAssertEqual(slots.map(1), 3)

        slots.beginConnection()
        XCTAssertEqual(slots.map(0), 4)
    }

    func testSlotsStayPutWhenAConnectionTranscribedNothing() {
        var slots = LiveSpeakerSlotRebase()
        slots.beginConnection()
        slots.beginConnection()
        XCTAssertEqual(slots.map(0), 0)
    }

    // MARK: - Settings launch guard

    func testSettingsCountsAsUserOpenedOnlyForKeyOrClickEvents() {
        XCTAssertTrue(SettingsLaunchGuard.isUserOpened(eventType: .keyDown), "⌘, key equivalent")
        XCTAssertTrue(SettingsLaunchGuard.isUserOpened(eventType: .leftMouseUp), "menu pick")
        XCTAssertFalse(SettingsLaunchGuard.isUserOpened(eventType: nil), "nothing dispatched yet at launch")
        XCTAssertFalse(SettingsLaunchGuard.isUserOpened(eventType: .appKitDefined), "app activation")
        XCTAssertFalse(SettingsLaunchGuard.isUserOpened(eventType: .mouseMoved))
    }
}
