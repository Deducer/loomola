import Foundation

enum TrackKind: String, Codable, CaseIterable, Sendable {
    case composite
    case screen
    case camera
    case mic
    case systemAudio = "system-audio"
}

struct RecordingSettings: Equatable, Sendable {
    var resolution: String = "screen-native"
    var brandProfileId: String?
    var includeCamera: Bool = true
    var includeMic: Bool = true
    var includeSystemAudio: Bool = true
}

struct CompletedPart: Codable, Equatable, Sendable {
    let partNumber: Int
    let eTag: String

    enum CodingKeys: String, CodingKey {
        case partNumber = "PartNumber"
        case eTag = "ETag"
    }
}

struct BubblePlacement: Equatable, Sendable {
    var frameInScreenCoordinates: CGRect
    var capturedDisplayFrame: CGRect

    var normalizedCenter: CGPoint {
        CGPoint(
            x: (frameInScreenCoordinates.midX - capturedDisplayFrame.minX) / capturedDisplayFrame.width,
            y: (frameInScreenCoordinates.midY - capturedDisplayFrame.minY) / capturedDisplayFrame.height
        )
    }
}
