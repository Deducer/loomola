import CoreGraphics
import Foundation

/// Renderable shape of the bubble overlay. Pixel-rect math is identical
/// across shapes; this is consumed by the compositor's clip-path step.
enum BubbleShape: Sendable, Equatable {
    case circle
    case rectangle
}

/// Where the bubble lives on the user's desktop, in AppKit screen
/// coordinates (y-up, points). Source of truth for the on-screen
/// `BubbleOverlayWindowController` panel frame and for the future
/// `CompositeRecorder` projection into captured-pixel coordinates.
struct BubblePlacement: Sendable, Equatable {
    let frameInScreenPoints: CGRect
    let shape: BubbleShape

    init(frameInScreenPoints: CGRect, shape: BubbleShape) {
        self.frameInScreenPoints = frameInScreenPoints
        self.shape = shape
    }

    /// Project the bubble's AppKit-y-up screen frame into the captured
    /// display's top-left-origin pixel coordinate system. Handles
    /// Retina backing scale + multi-display origin offsets. Returns
    /// `nil` when the bubble has no overlap with the supplied display.
    /// Returned rect is clamped to display bounds — bubbles partly off
    /// the edge get cropped to the visible region rather than spilling
    /// outside the captured frame.
    func pixelRect(in display: DisplayPixelBounds) -> CGRect? {
        // Translate panel frame into display-local AppKit coordinates.
        let localOriginX = frameInScreenPoints.origin.x - display.appKitOriginPoints.x
        let localOriginY = frameInScreenPoints.origin.y - display.appKitOriginPoints.y
        let panelW = frameInScreenPoints.size.width
        let panelH = frameInScreenPoints.size.height

        // Flip y from AppKit (bottom-up) to ScreenCaptureKit (top-down).
        // localOriginY is the panel's bottom edge in AppKit local-y;
        // top edge in top-down local-y is heightPoints - (localOriginY + panelH).
        let topDownY = display.sizePoints.height - (localOriginY + panelH)

        let localPointsRect = CGRect(
            x: localOriginX,
            y: topDownY,
            width: panelW,
            height: panelH
        )

        // Clamp to display bounds (in points), then scale to pixels.
        let displayBounds = CGRect(
            origin: .zero,
            size: display.sizePoints
        )
        let clampedPoints = localPointsRect.intersection(displayBounds)
        if clampedPoints.isNull || clampedPoints.isEmpty {
            return nil
        }

        let scale = display.backingScaleFactor
        return CGRect(
            x: clampedPoints.origin.x * scale,
            y: clampedPoints.origin.y * scale,
            width: clampedPoints.size.width * scale,
            height: clampedPoints.size.height * scale
        )
    }
}

/// Geometry of a captured display, expressed both in AppKit points
/// (for translating panel frames) and via the backing scale factor (for
/// converting to ScreenCaptureKit pixel coordinates). Pure-data, no
/// AppKit / ScreenCaptureKit dependency.
struct DisplayPixelBounds: Sendable, Equatable {
    let appKitOriginPoints: CGPoint
    let sizePoints: CGSize
    let backingScaleFactor: CGFloat

    init(
        appKitOriginPoints: CGPoint,
        sizePoints: CGSize,
        backingScaleFactor: CGFloat
    ) {
        self.appKitOriginPoints = appKitOriginPoints
        self.sizePoints = sizePoints
        self.backingScaleFactor = backingScaleFactor
    }
}
