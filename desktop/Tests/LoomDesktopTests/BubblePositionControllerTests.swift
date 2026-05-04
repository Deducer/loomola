import XCTest
@testable import LoomDesktopApp

final class BubblePositionControllerTests: XCTestCase {
    func testInitialPlacementIsNil() {
        let controller = BubblePositionController()
        XCTAssertNil(controller.current())
    }

    func testSetThenGetReturnsTheSamePlacement() {
        let controller = BubblePositionController()
        let placement = BubblePlacement(
            frameInScreenPoints: CGRect(x: 100, y: 100, width: 180, height: 180),
            shape: .circle
        )
        controller.set(placement)
        XCTAssertEqual(controller.current(), placement)
    }

    func testSetNilClearsPlacement() {
        let controller = BubblePositionController()
        controller.set(
            BubblePlacement(
                frameInScreenPoints: CGRect(x: 0, y: 0, width: 10, height: 10),
                shape: .circle
            )
        )
        controller.set(nil)
        XCTAssertNil(controller.current())
    }

    func testConcurrentReadsAndWritesAreSafe() async {
        let controller = BubblePositionController()
        // Hammer the controller from many concurrent tasks. If this races
        // it'll trip TSan or crash; if it serializes cleanly the assertion
        // at the end finds whatever the last writer left.
        await withTaskGroup(of: Void.self) { group in
            for i in 0..<200 {
                group.addTask {
                    let placement = BubblePlacement(
                        frameInScreenPoints: CGRect(
                            x: CGFloat(i),
                            y: CGFloat(i),
                            width: 100,
                            height: 100
                        ),
                        shape: i % 2 == 0 ? .circle : .rectangle
                    )
                    controller.set(placement)
                    _ = controller.current()
                }
            }
        }
        XCTAssertNotNil(controller.current())
    }
}
