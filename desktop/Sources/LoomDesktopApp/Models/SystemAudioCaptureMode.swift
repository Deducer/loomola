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
            return "Audio device"
        }
    }

    var detail: String {
        switch self {
        case .screenCaptureKit:
            return "Best for meetings"
        case .audioDevice:
            return "Best for SoundSource"
        }
    }
}
