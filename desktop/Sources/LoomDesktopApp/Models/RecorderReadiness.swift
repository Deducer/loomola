import AppKit
import Foundation

enum RecorderReadinessMode: Equatable, Sendable {
    case video
    case audio
}

enum RecorderReadinessState: Equatable, Sendable {
    case checking
    case ready
    case degraded
    case blocked
}

enum RecorderReadinessIssueSeverity: Equatable, Sendable {
    case warning
    case blocker
}

struct RecorderReadinessIssue: Identifiable, Equatable, Sendable {
    let id: String
    let severity: RecorderReadinessIssueSeverity
    let title: String
    let message: String
}

enum BackendReadinessStatus: Equatable, Sendable {
    case unknown
    case checking
    case reachable
    case unreachable(String)
}

struct RecorderReadinessSnapshot: Equatable, Sendable {
    let mode: RecorderReadinessMode
    let state: RecorderReadinessState
    let summary: String
    let detail: String?
    let issues: [RecorderReadinessIssue]
    let checkedAt: Date

    var canStart: Bool {
        state == .ready || state == .degraded
    }

    var primaryIssue: RecorderReadinessIssue? {
        issues.first { $0.severity == .blocker } ?? issues.first
    }

    static func checking(mode: RecorderReadinessMode) -> RecorderReadinessSnapshot {
        RecorderReadinessSnapshot(
            mode: mode,
            state: .checking,
            summary: "Checking setup",
            detail: nil,
            issues: [],
            checkedAt: Date()
        )
    }
}

struct RecorderReadinessInput: Equatable, Sendable {
    let mode: RecorderReadinessMode
    let isSignedIn: Bool
    let backendStatus: BackendReadinessStatus
    let permissionStatus: PermissionStatus
    let captureSources: CaptureSourceSnapshot
    let captureSourcesLoaded: Bool
    let selectedCameraDeviceID: String?
    let selectedMicDeviceID: String?
    let includeMic: Bool
    let includeSystemAudio: Bool
    let systemAudioCaptureMode: SystemAudioCaptureMode
    let selectedSystemAudioDeviceID: String?
    let allowsAppleSystemAudioCapture: Bool
    let supportsScreenCaptureKit: Bool
    let hasMainScreen: Bool
    let hasUnrescuedOrphans: Bool
}

enum RecorderReadinessEvaluator {
    static func evaluate(_ input: RecorderReadinessInput) -> RecorderReadinessSnapshot {
        if input.isSignedIn &&
            (input.backendStatus == .checking || input.backendStatus == .unknown)
        {
            return .checking(mode: input.mode)
        }

        var issues: [RecorderReadinessIssue] = []

        if !input.isSignedIn {
            issues.append(.blocker(
                id: "signed-out",
                title: "Sign in needed",
                message: "Sign in before recording so the meeting can sync."
            ))
        }

        if case .unreachable(let message) = input.backendStatus {
            issues.append(.blocker(
                id: "backend-unreachable",
                title: "Loomola is offline",
                message: message.isEmpty ? "The server check failed." : message
            ))
        }

        if input.hasUnrescuedOrphans {
            issues.append(.warning(
                id: "orphaned-recording",
                title: "Recovery waiting",
                message: "A previous recording is saved locally in Recovery."
            ))
        }

        switch input.mode {
        case .video:
            evaluateVideo(input, issues: &issues)
        case .audio:
            evaluateAudio(input, issues: &issues)
        }

        let blockers = issues.filter { $0.severity == .blocker }
        let state: RecorderReadinessState
        let summary: String
        let detail: String?

        if let firstBlocker = blockers.first {
            state = .blocked
            summary = "Needs attention"
            detail = firstBlocker.title
        } else if let firstWarning = issues.first {
            state = .degraded
            summary = "Ready with note"
            detail = firstWarning.title
        } else {
            state = .ready
            summary = "Ready to record"
            detail = input.mode == .audio ? "Audio note checks passed" : "Video checks passed"
        }

        return RecorderReadinessSnapshot(
            mode: input.mode,
            state: state,
            summary: summary,
            detail: detail,
            issues: issues,
            checkedAt: Date()
        )
    }

    private static func evaluateVideo(
        _ input: RecorderReadinessInput,
        issues: inout [RecorderReadinessIssue]
    ) {
        if !input.supportsScreenCaptureKit {
            issues.append(.blocker(
                id: "screen-capture-kit",
                title: "macOS update needed",
                message: "Video recording requires macOS 14 or newer."
            ))
        }

        if !input.hasMainScreen {
            issues.append(.blocker(
                id: "no-display",
                title: "No display found",
                message: "Loomola could not find an active display to capture."
            ))
        }

        require(\.camera, named: "Camera", id: "camera-permission", issues: &issues)
        require(\.microphone, named: "Microphone", id: "microphone-permission", issues: &issues)
        require(\.screenRecording, named: "Screen recording", id: "screen-permission", issues: &issues)

        if input.captureSourcesLoaded && input.captureSources.displays.isEmpty {
            issues.append(.blocker(
                id: "no-capture-displays",
                title: "No capturable display",
                message: "ScreenCaptureKit did not return a display."
            ))
        }

        if input.captureSourcesLoaded,
           let selectedCameraDeviceID = input.selectedCameraDeviceID,
           !input.captureSources.cameras.contains(where: { $0.id == selectedCameraDeviceID })
        {
            issues.append(.warning(
                id: "selected-camera-missing",
                title: "Camera changed",
                message: "The selected camera is unavailable; Loomola will use the system default."
            ))
        }

        if input.captureSourcesLoaded,
           let selectedMicDeviceID = input.selectedMicDeviceID,
           !input.captureSources.microphones.contains(where: { $0.id == selectedMicDeviceID })
        {
            issues.append(.warning(
                id: "selected-video-mic-missing",
                title: "Mic changed",
                message: "The selected microphone is unavailable; Loomola will use the system default."
            ))
        }

        func require(
            _ keyPath: KeyPath<PermissionStatus, PermissionStatus.State>,
            named name: String,
            id: String,
            issues: inout [RecorderReadinessIssue]
        ) {
            guard input.permissionStatus[keyPath: keyPath] != .granted else { return }
            issues.append(.blocker(
                id: id,
                title: "\(name) permission",
                message: "\(name) access is required for video recording."
            ))
        }
    }

    private static func evaluateAudio(
        _ input: RecorderReadinessInput,
        issues: inout [RecorderReadinessIssue]
    ) {
        if !input.includeMic && !input.includeSystemAudio {
            issues.append(.blocker(
                id: "audio-inputs-off",
                title: "No audio source",
                message: "Turn on Mic or System audio before starting."
            ))
        }

        if input.includeMic {
            if input.permissionStatus.microphone != .granted {
                issues.append(.blocker(
                    id: "audio-microphone-permission",
                    title: "Microphone permission",
                    message: "Microphone access is required for audio notes."
                ))
            }
            if input.captureSourcesLoaded && input.captureSources.microphones.isEmpty {
                issues.append(.blocker(
                    id: "no-microphones",
                    title: "No microphone found",
                    message: "Loomola could not find a microphone."
                ))
            }
            if input.captureSourcesLoaded,
               let selectedMicDeviceID = input.selectedMicDeviceID,
               !input.captureSources.microphones.contains(where: { $0.id == selectedMicDeviceID })
            {
                issues.append(.blocker(
                    id: "selected-audio-mic-missing",
                    title: "Mic changed",
                    message: "Choose an available microphone before starting."
                ))
            }
        }

        guard input.includeSystemAudio else { return }

        switch input.systemAudioCaptureMode {
        case .audioDevice:
            guard let selectedSystemAudioDeviceID = input.selectedSystemAudioDeviceID else {
                issues.append(.blocker(
                    id: "system-audio-device-missing",
                    title: "System audio device",
                    message: "Choose a virtual system-audio device before starting."
                ))
                return
            }
            if input.captureSourcesLoaded &&
                !input.captureSources.microphones.contains(where: { $0.id == selectedSystemAudioDeviceID })
            {
                issues.append(.blocker(
                    id: "system-audio-device-unavailable",
                    title: "System audio changed",
                    message: "The selected system-audio device is unavailable."
                ))
            }
        case .screenCaptureKit:
            if !input.allowsAppleSystemAudioCapture {
                if input.includeMic {
                    issues.append(.warning(
                        id: "apple-system-audio-disabled",
                        title: "Mic-only fallback",
                        message: "Apple system audio is disabled; Loomola will keep mic capture available."
                    ))
                } else {
                    issues.append(.blocker(
                        id: "apple-system-audio-blocked",
                        title: "System audio unavailable",
                        message: "Turn on Mic or switch to the default System audio mode."
                    ))
                }
            }
        case .coreAudioTap:
            break
        }
    }
}

private extension RecorderReadinessIssue {
    static func warning(id: String, title: String, message: String) -> RecorderReadinessIssue {
        RecorderReadinessIssue(id: id, severity: .warning, title: title, message: message)
    }

    static func blocker(id: String, title: String, message: String) -> RecorderReadinessIssue {
        RecorderReadinessIssue(id: id, severity: .blocker, title: title, message: message)
    }
}
