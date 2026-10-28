import AppKit
import ImageIO
import SwiftUI

/// Decoded, downsampled thumbnails keyed by recording id. The recent
/// list used to hand every row an `AsyncImage` of a presigned URL:
/// the URL changes on each 60 s refresh, so every refresh re-fetched
/// and re-decoded full-size JPEGs while the user scrolled. Keying on
/// the recording id keeps one small bitmap per row for the session.
@MainActor
final class ThumbnailCache {
    static let shared = ThumbnailCache()

    private let cache = NSCache<NSString, NSImage>()
    private var inFlight: [String: Task<NSImage?, Never>] = [:]

    init() {
        cache.countLimit = 600
    }

    func image(for key: String) -> NSImage? {
        cache.object(forKey: key as NSString)
    }

    /// Fetches and downsamples once per key; concurrent callers share
    /// the same task.
    func load(key: String, url: URL, maxPixel: Int) async -> NSImage? {
        if let hit = image(for: key) { return hit }
        if let task = inFlight[key] { return await task.value }
        let task = Task.detached(priority: .utility) { () -> NSImage? in
            guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
            return ThumbnailCache.downsample(data: data, maxPixel: maxPixel)
        }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        if let image { cache.setObject(image, forKey: key as NSString) }
        return image
    }

    /// Decode straight to a small bitmap; a 1280×720 JPEG becomes a
    /// few KB instead of a 3.5 MB backing store per row.
    nonisolated static func downsample(data: Data, maxPixel: Int) -> NSImage? {
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, options as CFDictionary) else { return nil }
        let thumbOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions as CFDictionary) else { return nil }
        return NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
    }
}

/// A thumbnail that reads the cache synchronously (no flash on
/// re-render) and loads once when missing.
struct ThumbnailImage<Placeholder: View>: View {
    let key: String
    let url: URL?
    let maxPixel: Int
    @ViewBuilder let placeholder: () -> Placeholder

    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image = image ?? ThumbnailCache.shared.image(for: key) {
                Image(nsImage: image).resizable().scaledToFill()
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard let url, ThumbnailCache.shared.image(for: key) == nil else { return }
            image = await ThumbnailCache.shared.load(key: key, url: url, maxPixel: maxPixel)
        }
    }
}
