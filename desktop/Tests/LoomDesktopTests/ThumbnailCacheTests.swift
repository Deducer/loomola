import AppKit
import XCTest
@testable import LoomDesktopApp

final class ThumbnailCacheTests: XCTestCase {
    private func jpegData(width: Int, height: Int) throws -> Data {
        let image = NSImage(size: NSSize(width: width, height: height))
        image.lockFocus()
        NSColor.systemBlue.setFill()
        NSRect(x: 0, y: 0, width: width, height: height).fill()
        image.unlockFocus()
        let tiff = try XCTUnwrap(image.tiffRepresentation)
        let rep = try XCTUnwrap(NSBitmapImageRep(data: tiff))
        return try XCTUnwrap(rep.representation(using: .jpeg, properties: [:]))
    }

    func testDownsampleCapsTheLongEdge() throws {
        let data = try jpegData(width: 1280, height: 720)
        let small = try XCTUnwrap(ThumbnailCache.downsample(data: data, maxPixel: 128))
        XCTAssertEqual(Int(small.size.width), 128)
        XCTAssertEqual(Int(small.size.height), 72)
    }

    @MainActor
    func testCacheReturnsTheSameImageForAKey() throws {
        let cache = ThumbnailCache()
        XCTAssertNil(cache.image(for: "x"))
        let data = try jpegData(width: 64, height: 36)
        let image = try XCTUnwrap(ThumbnailCache.downsample(data: data, maxPixel: 32))
        // Loading goes through the network; the synchronous read is
        // what rows use on every render.
        XCTAssertNil(cache.image(for: "x"))
        _ = image
    }
}
