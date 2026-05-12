import Foundation

enum SystemAudioCaptureMode: String, CaseIterable, Identifiable, Sendable {
    case screenCaptureKit
    case audioDevice

    var id: String { rawValue }

    var title: String {
        switch self {
        case .screenCaptureKit:
            return "Apple system audio"
        case .audioDevice:
            return "Virtual audio device"
        }
    }

    var detail: String {
        switch self {
        case .screenCaptureKit:
            return "Experimental"
        case .audioDevice:
            return "Best for stable calls"
        }
    }
}
