import XCTest
import CoreGraphics
@testable import LoomDesktopApp

final class BubblePlacementTests: XCTestCase {
    private func display1x() -> DisplayPixelBounds {
        DisplayPixelBounds(
            appKitOriginPoints: CGPoint(x: 0, y: 0),
            sizePoints: CGSize(width: 1440, height: 900),
            backingScaleFactor: 1.0
        )
    }

    private func display2x() -> DisplayPixelBounds {
        DisplayPixelBounds(
            appKitOriginPoints: CGPoint(x: 0, y: 0),
            sizePoints: CGSize(width: 1512, height: 982),
            backingScaleFactor: 2.0
        )
    }

    // MARK: - 1× display

    func testBubbleInCenterOf1xDisplay() {
        // Panel: 100×100 at (670, 400) in AppKit screen coords (y-up).
        // Display origin: (0, 0). Display height: 900 points.
        // localY (AppKit) = 400. Panel top-left in AppKit = y = 400+100 = 500.
        // Flipped (top-down) y = 900 - (400 + 100) = 400.
        let placement = BubblePlacement(
            frameInScreenPoints: CGRect(x: 670, y: 400, width: 100, height: 100),
            shape: .circle
        )
        let pixels = placement.pixelRect(in: display1x())
        XCTAssertNotNil(pixels)
        XCTAssertEqual(pixels?.origin.x, 670)
        XCTAssertEqual(pixels?.origin.y, 400)
        XCTAssertEqual(pixels?.size.width, 100)
        XCTAssertEqual(pixels?.size.height, 100)
    }

    // MARK: - 2× Retina display

    func testBubbleInCenterOf2xRetinaDisplayScalesByBackingFactor() {
        // 2x display: 1512×982 points = 3024×1964 pixels.
        // Panel: 200×200 at (656, 391) in AppKit screen coords.
        // Local AppKit-y = 391. Top-down y = 982 - (391 + 200) = 391.
        // Pixels: origin (656, 391) * 2 = (1312, 782); size (200, 200) * 2 = (400, 400).
        let placement = BubblePlacement(
            frameInScreenPoints: CGRect(x: 656, y: 391, width: 200, height: 200),
            shape: .circle
        )
        let pixels = placement.pixelRect(in: display2x())
        XCTAssertEqual(pixels?.origin.x, 1312)
        XCTAssertEqual(pixels?.origin.y, 782)
        XCTAssertEqual(pixels?.size.width, 400)
        XCTAssertEqual(pixels?.size.height, 400)
    }

    // MARK: - Multi-display with primary on the right

    func testBubbleOnSecondaryDisplayWithNegativeOrigin() {
        // Primary display is on the right at appKitOrigin (0, 0).
        // Secondary display is to the left of primary at appKitOrigin (-1440, 0).
        // Bubble panel placed on the secondary: AppKit origin (-1340, 400), size 100x100.
        // Local-x in secondary = -1340 - (-1440) = 100.
        // Local-y in secondary AppKit = 400. Top-down y = 900 - 500 = 400.
        let secondary = DisplayPixelBounds(
            appKitOriginPoints: CGPoint(x: -1440, y: 0),
            sizePoints: CGSize(width: 1440, height: 900),
            backingScaleFactor: 1.0
        )
        let placement = BubblePlacement(
            frameInScreenPoints: CGRect(x: -1340, y: 400, width: 100, height: 100),
            shape: .circle
        )
        let pixels = placement.pixelRect(in: secondary)
        XCTAssertEqual(pixels?.origin.x, 100)
        XCTAssertEqual(pixels?.origin.y, 400)
        XCTAssertEqual(pixels?.size.width, 100)
        XCTAssertEqual(pixels?.size.height, 100)
    }

    // MARK: - Off-display behavior

    func testBubbleEntirelyOutsideDisplayReturnsNil() {
        // Display 1440x900 at origin (0, 0). Bubble far to the right at x=2000.
        let placement = BubblePlacement(
            frameInScreenPoints: CGRect(x: 2000, y: 100, width: 100, height: 100),
            shape: .circle
        )
        XCTAssertNil(placement.pixelRect(in: display1x()))
    }

    func testBubblePartlyOffRightEdgeIsClampedToDisplayBounds() {
        // 1× 1440×900 display. Bubble 100×100 at (1400, 100) — extends to x=1500
        // (100 px past the right edge). After clamping: width should shrink to
        // 40, origin x = 1400.
        let placement = BubblePlacement(
            frameInScreenPoints: CGRect(x: 1400, y: 100, width: 100, height: 100),
            shape: .circle
        )
        let pixels = placement.pixelRect(in: display1x())
        XCTAssertNotNil(pixels)
        XCTAssertEqual(pixels?.origin.x, 1400)
        XCTAssertEqual(pixels?.size.width, 40)
        XCTAssertEqual(pixels?.size.height, 100)
    }

    // MARK: - Corners

    func testBubbleAtTopLeftCornerOfDisplay() {
        // AppKit top-left of a 1× display 1440×900 at origin (0, 0):
        // bubble origin AppKit = (0, 800), size 100. Top-down y = 900 - 900 = 0.
        let placement = BubblePlacement(
            frameInScreenPoints: CGRect(x: 0, y: 800, width: 100, height: 100),
            shape: .circle
        )
        let pixels = placement.pixelRect(in: display1x())
        XCTAssertEqual(pixels?.origin.x, 0)
        XCTAssertEqual(pixels?.origin.y, 0)
    }

    func testBubbleAtBottomRightCornerOfDisplay() {
        // 1× 1440×900 display. Bubble 100x100 at AppKit (1340, 0).
        // Top-down y = 900 - 100 = 800. Origin (1340, 800), size (100, 100).
        let placement = BubblePlacement(
            frameInScreenPoints: CGRect(x: 1340, y: 0, width: 100, height: 100),
            shape: .circle
        )
        let pixels = placement.pixelRect(in: display1x())
        XCTAssertEqual(pixels?.origin.x, 1340)
        XCTAssertEqual(pixels?.origin.y, 800)
        XCTAssertEqual(pixels?.size.width, 100)
        XCTAssertEqual(pixels?.size.height, 100)
    }

    // MARK: - Shape

    func testCircleVsRectangleProducesIdenticalPixelRect() {
        // Shape is rendering-only; pixel rect should be identical for the
        // same frame.
        let frame = CGRect(x: 100, y: 100, width: 100, height: 100)
        let circle = BubblePlacement(frameInScreenPoints: frame, shape: .circle)
        let rect = BubblePlacement(frameInScreenPoints: frame, shape: .rectangle)
        XCTAssertEqual(circle.pixelRect(in: display1x()), rect.pixelRect(in: display1x()))
    }
}
