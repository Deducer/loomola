import AppKit
import SwiftUI

/// First-launch / permissions-missing surface. Replaces the M2-era
/// banner-stacked-above-content treatment with a hero card that owns
/// the whole viewport. When the user grants all required permissions,
/// `onComplete` fires and the parent swaps in IdleHomeView.
struct PermissionsHomeView: View {
    @State private var status: PermissionStatus = PermissionChecker.currentStatus()
    @State private var requesting: PermissionChecker.WhichPermission?
    /// Snapshot of screen-recording state at view-init time. If the
    /// user grants screen recording later (denied/notDetermined →
    /// granted), the running process can't use it until restart —
    /// macOS only re-evaluates at launch. We surface a Relaunch CTA
    /// in that exact case.
    @State private var screenRecordingAtLaunch: PermissionStatus.State =
        PermissionChecker.currentStatus().screenRecording

    let onComplete: () -> Void
    let onSkip: () -> Void

    private var needsRelaunchForScreenRecording: Bool {
        screenRecordingAtLaunch != .granted && status.screenRecording == .granted
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.xl) {
                Text("Set up permissions")
                    .font(DSFont.Display.xl())
                    .foregroundStyle(DSColor.Text.primary)
                    .padding(.top, DSSpacing.lg)

                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    Text("Loomola needs four permissions from macOS to record. We'll walk through them — granting opens the system prompt or jumps to System Settings, depending on what's available.")
                        .font(DSFont.Body.md())
                        .foregroundStyle(DSColor.Text.secondary)

                    if needsRelaunchForScreenRecording {
                        relaunchBanner
                    }

                    VStack(spacing: DSSpacing.md) {
                        permissionRow(
                            title: "Camera",
                            description: "Powers the bubble preview and composite recording.",
                            state: status.camera,
                            required: true,
                            onRequest: { Task { await request(.camera) } },
                            onOpenSettings: { PermissionChecker.openSystemSettings(for: .camera) },
                            isRequesting: requesting == .camera
                        )
                        permissionRow(
                            title: "Microphone",
                            description: "Records narration with macOS acoustic echo cancellation.",
                            state: status.microphone,
                            required: true,
                            onRequest: { Task { await request(.microphone) } },
                            onOpenSettings: { PermissionChecker.openSystemSettings(for: .microphone) },
                            isRequesting: requesting == .microphone
                        )
                        permissionRow(
                            title: "Screen recording",
                            description: "Captures the desktop the bubble overlays. macOS may need an app restart after granting.",
                            state: status.screenRecording,
                            required: true,
                            onRequest: { Task { await request(.screenRecording) } },
                            onOpenSettings: { PermissionChecker.openSystemSettings(for: .screenRecording) },
                            isRequesting: requesting == .screenRecording
                        )
                        permissionRow(
                            title: "Accessibility (optional)",
                            description: "Some setups require this for the ⌥⇧B / ⌥⇧R global hotkeys.",
                            state: status.accessibility,
                            required: false,
                            onRequest: { Task { await request(.accessibility) } },
                            onOpenSettings: { PermissionChecker.openSystemSettings(for: .accessibility) },
                            isRequesting: requesting == .accessibility
                        )
                    }

                    HStack {
                        Spacer()
                        Text("Skip for now")
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.secondary)
                            .contentShape(Rectangle())
                            .overlay { ActionHitArea(action: onSkip) }
                        if !status.requiredMissing {
                            PrimaryButton("Continue", icon: "arrow.right", action: onComplete)
                        }
                    }
                }
                .padding(.horizontal, DSSpacing.xl)
                .padding(.vertical, DSSpacing.xl)
                .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
                .dsShadow(.subtle)
            }
            .padding(.horizontal, DSSpacing.xxl)
            .padding(.bottom, DSSpacing.xxl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in
            status = PermissionChecker.currentStatus()
            if !status.requiredMissing {
                onComplete()
            }
        }
    }

    private var relaunchBanner: some View {
        HStack(alignment: .center, spacing: DSSpacing.md) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(DSColor.State.warning)
            VStack(alignment: .leading, spacing: 2) {
                Text("Restart needed for screen recording")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text("macOS only re-evaluates Screen Recording access at app launch. Click Relaunch to pick up the change.")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
            }
            Spacer()
            PrimaryButton("Relaunch", icon: "arrow.clockwise") {
                AppRelauncher.relaunch()
            }
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, DSSpacing.md)
        .background(DSColor.State.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: DSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md)
                .strokeBorder(DSColor.State.warning.opacity(0.35), lineWidth: 1)
        )
    }

    private func permissionRow(
        title: String,
        description: String,
        state: PermissionStatus.State,
        required: Bool,
        onRequest: @escaping () -> Void,
        onOpenSettings: @escaping () -> Void,
        isRequesting: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: DSSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text(description)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Pill(pillTitle(state), kind: pillKind(state))

            switch state {
            case .granted:
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(DSColor.State.success)
                    .frame(width: 110, alignment: .center)
            case .notDetermined:
                PrimaryButton(isRequesting ? "Requesting…" : "Request", action: onRequest)
                    .disabled(isRequesting)
                    .frame(width: 130)
            case .denied:
                SecondaryButton("Open Settings", icon: "gear", action: onOpenSettings)
                    .frame(width: 160)
            }
        }
        .padding(.vertical, DSSpacing.xs)
    }

    @MainActor
    private func request(_ which: PermissionChecker.WhichPermission) async {
        requesting = which
        defer { requesting = nil }
        switch which {
        case .camera:
            _ = await PermissionChecker.requestCamera()
        case .microphone:
            _ = await PermissionChecker.requestMicrophone()
        case .screenRecording:
            PermissionChecker.requestScreenRecording()
            PermissionChecker.markScreenRecordingAsked()
        case .accessibility:
            PermissionChecker.openSystemSettings(for: .accessibility)
        }
        status = PermissionChecker.currentStatus()
        if !status.requiredMissing {
            onComplete()
        }
    }

    private func pillTitle(_ state: PermissionStatus.State) -> String {
        switch state {
        case .granted: return "Granted"
        case .denied: return "Denied"
        case .notDetermined: return "Not asked"
        }
    }

    private func pillKind(_ state: PermissionStatus.State) -> Pill.Kind {
        switch state {
        case .granted: return .success
        case .denied: return .recording
        case .notDetermined: return .warning
        }
    }
}
