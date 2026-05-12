import Foundation

enum SystemAudioCaptureMode: String, CaseIterable, Identifiable, Sendable {
    case coreAudioTap
    case screenCaptureKit
    case audioDevice

    var id: String { rawValue }

    var title: String {
        switch self {
        case .coreAudioTap:
            return "System audio"
        case .screenCaptureKit:
            return "ScreenCaptureKit audio"
        case .audioDevice:
            return "Virtual audio device"
        }
    }

    var detail: String {
        switch self {
        case .coreAudioTap:
            return "No audio rerouting"
        case .screenCaptureKit:
            return "Experimental"
        case .audioDevice:
            return "Fallback"
        }
    }
}
