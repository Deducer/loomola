import CoreMedia
import XCTest
@testable import LoomDesktopApp

final class CameraFrameHistoryTests: XCTestCase {
    func testKeepsOnlyNewestFramesWithinCapacity() {
        var history = CameraFrameHistory<Int>(capacity: 2)

        history.append(1, presentationTime: time(1))
        history.append(2, presentationTime: time(2))
        history.append(3, presentationTime: time(3))

        XCTAssertEqual(history.count, 2)
        XCTAssertEqual(history.latest(), 3)
        XCTAssertEqual(history.closest(to: time(1)), 2)
    }

    func testReturnsFrameClosestToRequestedTimestamp() {
        var history = CameraFrameHistory<String>(capacity: 5)

        history.append("early", presentationTime: time(10))
        history.append("target", presentationTime: time(11.9))
        history.append("late", presentationTime: time(13))

        XCTAssertEqual(history.closest(to: time(12)), "target")
    }

    func testFallsBackToLatestWhenTimestampDomainsDoNotMatch() {
        var history = CameraFrameHistory<String>(capacity: 5)

        history.append("old", presentationTime: time(10))
        history.append("latest", presentationTime: time(11))

        XCTAssertEqual(history.closest(to: time(100)), "latest")
    }

    func testInvalidTargetFallsBackToLatest() {
        var history = CameraFrameHistory<String>(capacity: 5)

        history.append("latest", presentationTime: time(11))

        XCTAssertEqual(history.closest(to: .invalid), "latest")
    }

    private func time(_ seconds: Double) -> CMTime {
        CMTime(seconds: seconds, preferredTimescale: 600)
    }
}
