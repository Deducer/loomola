import XCTest
@testable import LoomDesktopApp

final class CaptureSourceSnapshotTests: XCTestCase {
    func testSnapshotStoresCaptureChoices() {
        let snapshot = CaptureSourceSnapshot(
            displays: [DisplaySource(id: 1, name: "Display 1", width: 3840, height: 2160)],
            windows: [WindowSource(id: 10, title: "Demo", applicationName: "Safari")],
            cameras: [MediaDeviceSource(id: "camera", name: "Opal")],
            microphones: [MediaDeviceSource(id: "mic", name: "Studio Mic")]
        )

        XCTAssertEqual(snapshot.displays.first?.width, 3840)
        XCTAssertEqual(snapshot.windows.first?.applicationName, "Safari")
        XCTAssertEqual(snapshot.cameras.first?.name, "Opal")
        XCTAssertEqual(snapshot.microphones.first?.id, "mic")
    }
}
