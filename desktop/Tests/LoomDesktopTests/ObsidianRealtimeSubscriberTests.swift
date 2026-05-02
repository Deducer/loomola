import Supabase
import XCTest
@testable import LoomDesktopApp

final class ObsidianRealtimeSubscriberTests: XCTestCase {
    func testShouldTriggerSyncForQueuedAudioNote() {
        let record: [String: AnyJSON] = [
            "type": "audio",
            "obsidian_save_requested_at": "2026-05-02T12:00:00Z",
            "obsidian_synced_at": nil,
        ]

        XCTAssertTrue(ObsidianRealtimeSubscriber.shouldTriggerSync(record: record))
    }

    func testShouldNotTriggerSyncForVideoOrAlreadySyncedNote() {
        XCTAssertFalse(
            ObsidianRealtimeSubscriber.shouldTriggerSync(record: [
                "type": "video",
                "obsidian_save_requested_at": "2026-05-02T12:00:00Z",
                "obsidian_synced_at": nil,
            ])
        )

        XCTAssertFalse(
            ObsidianRealtimeSubscriber.shouldTriggerSync(record: [
                "type": "audio",
                "obsidian_save_requested_at": "2026-05-02T12:00:00Z",
                "obsidian_synced_at": "2026-05-02T12:00:01Z",
            ])
        )
    }
}
