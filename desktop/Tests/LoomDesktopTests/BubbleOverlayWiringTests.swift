import XCTest
@testable import LoomDesktopApp

@MainActor
final class BubbleOverlayWiringTests: XCTestCase {
    func testControllerStartsWithNoPlacement() {
        let pc = BubblePositionController()
        _ = BubbleOverlayWindowController(positionController: pc, shape: .circle)
        XCTAssertNil(pc.current(), "no panel shown yet → no placement")
    }

    func testShowPublishesInitialPlacement() {
        let pc = BubblePositionController()
        let overlay = BubbleOverlayWindowController(
            positionController: pc,
            shape: .circle
        )
        overlay.showPlaceholder()

        let placement = pc.current()
        XCTAssertNotNil(placement, "showPlaceholder should publish a placement")
        XCTAssertEqual(placement?.shape, .circle)
        XCTAssertEqual(placement?.frameInScreenPoints.size.width, 180)
        XCTAssertEqual(placement?.frameInScreenPoints.size.height, 180)
    }

    func testHideClearsPlacement() {
        let pc = BubblePositionController()
        let overlay = BubbleOverlayWindowController(positionController: pc)
        overlay.showPlaceholder()
        XCTAssertNotNil(pc.current())
        overlay.hide()
        XCTAssertNil(pc.current(), "hide() should clear the published placement")
    }

    func testChangingShapeRepublishes() {
        let pc = BubblePositionController()
        let overlay = BubbleOverlayWindowController(
            positionController: pc,
            shape: .circle
        )
        overlay.showPlaceholder()
        XCTAssertEqual(pc.current()?.shape, .circle)
        overlay.shape = .rectangle
        XCTAssertEqual(pc.current()?.shape, .rectangle)
    }
}
