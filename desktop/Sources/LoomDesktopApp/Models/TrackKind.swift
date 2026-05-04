import Foundation

enum TrackKind: String, Codable, CaseIterable, Sendable {
    case composite
    case screen
    case camera
    case mic
    case systemAudio = "system-audio"
}

enum MediaObjectType: String, Codable, Sendable {
    case video
    case audio
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

// Note: the rich BubblePlacement type lives in Models/BubblePlacement.swift
// and is the source of truth for bubble geometry. The placeholder that
// previously lived here has been removed in favor of that type.
