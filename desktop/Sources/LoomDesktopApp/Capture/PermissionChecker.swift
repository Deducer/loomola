import AppKit
import AVFoundation
import CoreGraphics
import Foundation

/// Status snapshot of the four permissions Loomola needs to record:
///   • camera (AVFoundation, video) — for the bubble preview + composite
///   • microphone (AVFoundation, audio) — for the AEC mic capture
///   • screen recording (CG / ScreenCaptureKit) — for the desktop capture
///   • accessibility — required to receive the global hotkey via Carbon
///     when the OS is locked-down enough to require it (default config
///     usually doesn't, but some MDM policies do)
///
/// Pure data model. The view drives display + system-settings deep-links
/// off this struct; the helper at the bottom of this file refreshes it
/// from the live OS state.
struct PermissionStatus: Equatable, Sendable {
    enum State: Equatable, Sendable {
        case granted
        case denied
        case notDetermined
    }

    var camera: State
    var microphone: State
    var screenRecording: State
    var accessibility: State

    var allGranted: Bool {
        camera == .granted &&
        microphone == .granted &&
        screenRecording == .granted &&
        // Accessibility is OPTIONAL for the global hotkey — Carbon's
        // RegisterEventHotKey works without it on most setups. We
        // surface its state for transparency but don't gate "ready"
        // on it.
        true
    }

    /// True when any required permission is missing (camera / mic /
    /// screen). Used to gate the Start Recording button.
    var requiredMissing: Bool {
        camera != .granted ||
        microphone != .granted ||
        screenRecording != .granted
    }
}

enum PermissionChecker {
    /// Synchronous snapshot of all four permission states. Cheap to call
    /// repeatedly — used by the preflight view's `onAppear` and a
    /// window-becomes-key observer to refresh state when the user
    /// returns from System Settings.
    static func currentStatus() -> PermissionStatus {
        PermissionStatus(
            camera: cameraState(),
            microphone: micState(),
            screenRecording: screenRecordingState(),
            accessibility: accessibilityState()
        )
    }

    /// Async permission request for camera. Triggers the system prompt
    /// when state is `notDetermined`; otherwise resolves immediately
    /// with the existing decision. Always reports back via the main
    /// actor so the caller can update UI directly.
    @MainActor
    static func requestCamera() async -> PermissionStatus.State {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .granted
        case .denied, .restricted: return .denied
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            return granted ? .granted : .denied
        @unknown default: return .denied
        }
    }

    @MainActor
    static func requestMicrophone() async -> PermissionStatus.State {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .granted
        case .denied, .restricted: return .denied
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            return granted ? .granted : .denied
        @unknown default: return .denied
        }
    }

    /// Triggers the system Screen Recording prompt the first time it's
    /// called; subsequent calls (when state is `denied`) just return
    /// `denied` so the caller can deep-link to System Settings.
    static func requestScreenRecording() {
        // CGRequestScreenCaptureAccess presents the prompt on the first
        // call where status is `.notDetermined`. There's no async
        // version — the system shows a modal and the user has to grant
        // and (often) restart the app.
        _ = CGRequestScreenCaptureAccess()
    }

    static func openSystemSettings(for permission: WhichPermission) {
        guard let url = URL(string: permission.systemSettingsURL) else { return }
        NSWorkspace.shared.open(url)
    }

    enum WhichPermission {
        case camera
        case microphone
        case screenRecording
        case accessibility

        var systemSettingsURL: String {
            switch self {
            case .camera:
                return "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
            case .microphone:
                return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            case .screenRecording:
                return "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            case .accessibility:
                return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
        }
    }

    // MARK: - Per-permission state probes

    private static func cameraState() -> PermissionStatus.State {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .granted
        case .denied, .restricted: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    private static func micState() -> PermissionStatus.State {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .granted
        case .denied, .restricted: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    private static func screenRecordingState() -> PermissionStatus.State {
        // CGPreflightScreenCaptureAccess returns true when granted.
        // There's no notDetermined / denied distinction — Apple's
        // preflight just answers yes/no. We model "no" as either
        // `notDetermined` (first run) or `denied` (user already
        // declined) by tracking whether we've ever asked. UserDefaults
        // is the simplest persistence; the worst case if the flag is
        // wrong is the user sees "Request" instead of "Open Settings"
        // (or vice-versa) — recoverable.
        if CGPreflightScreenCaptureAccess() {
            return .granted
        }
        let askedKey = "loomola.permissionChecker.screenRecording.asked"
        let asked = UserDefaults.standard.bool(forKey: askedKey)
        return asked ? .denied : .notDetermined
    }

    private static func accessibilityState() -> PermissionStatus.State {
        // AXIsProcessTrustedWithOptions polls without prompting when
        // the prompt option is false. Returns true when our app has
        // been added to System Settings → Privacy & Security →
        // Accessibility.
        let prompt = "AXTrustedCheckOptionPrompt" as CFString
        let options: CFDictionary = [prompt: false] as CFDictionary
        return AXIsProcessTrustedWithOptions(options) ? .granted : .denied
    }

    /// Marks the screen-recording prompt as having been shown so we can
    /// distinguish "not asked yet" from "user said no." Called by the
    /// view after invoking requestScreenRecording().
    static func markScreenRecordingAsked() {
        UserDefaults.standard.set(true, forKey: "loomola.permissionChecker.screenRecording.asked")
    }
}
