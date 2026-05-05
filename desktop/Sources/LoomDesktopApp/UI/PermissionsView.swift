import AppKit
import SwiftUI

/// First-run permission walkthrough. Shows the four permissions
/// Loomola needs (camera, microphone, screen recording, accessibility)
/// with per-row status pills + "Request" / "Open System Settings"
/// buttons. Surfaces in the main recorder window when the M2
/// preflight banner detects required permissions are missing.
@MainActor
struct PermissionsView: View {
    @State private var status: PermissionStatus = PermissionChecker.currentStatus()
    @State private var requesting: PermissionChecker.WhichPermission?

    let onComplete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Set up permissions")
                        .font(.title3.weight(.semibold))
                    Text("Grant the four permissions below so Loomola can record screen + camera + mic.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if !status.requiredMissing {
                    Button("Continue", action: onComplete)
                        .buttonStyle(.borderedProminent)
                }
            }
            Divider()
            PermissionRow(
                title: "Camera",
                description: "Powers the bubble preview and composite recording.",
                state: status.camera,
                required: true,
                requesting: requesting == .camera,
                onRequest: { Task { await request(.camera) } },
                onOpenSettings: { PermissionChecker.openSystemSettings(for: .camera) }
            )
            PermissionRow(
                title: "Microphone",
                description: "Records narration with macOS acoustic echo cancellation.",
                state: status.microphone,
                required: true,
                requesting: requesting == .microphone,
                onRequest: { Task { await request(.microphone) } },
                onOpenSettings: { PermissionChecker.openSystemSettings(for: .microphone) }
            )
            PermissionRow(
                title: "Screen Recording",
                description: "Captures the desktop the bubble overlays. macOS often needs an app restart after granting.",
                state: status.screenRecording,
                required: true,
                requesting: requesting == .screenRecording,
                onRequest: { Task { await request(.screenRecording) } },
                onOpenSettings: { PermissionChecker.openSystemSettings(for: .screenRecording) }
            )
            PermissionRow(
                title: "Accessibility",
                description: "Optional. Some setups require this for the ⌥⇧B global hotkey to fire.",
                state: status.accessibility,
                required: false,
                requesting: requesting == .accessibility,
                onRequest: { Task { await request(.accessibility) } },
                onOpenSettings: { PermissionChecker.openSystemSettings(for: .accessibility) }
            )
        }
        .padding(20)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in
            status = PermissionChecker.currentStatus()
        }
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
            // Accessibility doesn't have a programmatic request flow —
            // jump straight to System Settings.
            PermissionChecker.openSystemSettings(for: .accessibility)
        }
        status = PermissionChecker.currentStatus()
    }
}

private struct PermissionRow: View {
    let title: String
    let description: String
    let state: PermissionStatus.State
    let required: Bool
    let requesting: Bool
    let onRequest: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            StatusPill(state: state)
                .frame(minWidth: 84, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(title).font(.headline)
                    if !required {
                        Text("optional")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            actionButton
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var actionButton: some View {
        switch state {
        case .granted:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .notDetermined:
            Button(action: onRequest) {
                if requesting {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Request")
                }
            }
            .controlSize(.small)
            .buttonStyle(.borderedProminent)
            .disabled(requesting)
        case .denied:
            Button("Open Settings", action: onOpenSettings)
                .controlSize(.small)
        }
    }
}

private struct StatusPill: View {
    let state: PermissionStatus.State

    var body: some View {
        let (label, color): (String, Color) = {
            switch state {
            case .granted: return ("Granted", .green)
            case .denied: return ("Denied", .red)
            case .notDetermined: return ("Not asked", .orange)
            }
        }()
        Text(label)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(color.opacity(0.14), in: Capsule())
    }
}
