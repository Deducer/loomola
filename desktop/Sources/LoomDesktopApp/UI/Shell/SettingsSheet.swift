import AppKit
import SwiftUI

/// Sheet presented from the title-bar gear icon. Houses Sources,
/// Permissions (when missing), Integrations, Diagnostics, and Account.
/// All actions route to the existing view-model methods so behavior
/// matches what the legacy MainRecorderView footer + integration card
/// did in M2.
struct SettingsSheet: View {
    let onDismiss: () -> Void

    @EnvironmentObject private var viewModel: RecorderViewModel
    @State private var permissionStatus: PermissionStatus = PermissionChecker.currentStatus()
    @State private var diagnosticsExpanded = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(DSColor.Border.subtle)
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.xxl) {
                    sourcesSection
                    if permissionStatus.requiredMissing || permissionStatus.camera == .denied
                        || permissionStatus.microphone == .denied
                        || permissionStatus.screenRecording == .denied
                    {
                        permissionsSection
                    }
                    integrationsSection
                    accountSection
                    diagnosticsSection
                }
                .padding(.horizontal, DSSpacing.xxl)
                .padding(.vertical, DSSpacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(width: 580, height: 620)
        .background(DSColor.Bg.surface)
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in
            permissionStatus = PermissionChecker.currentStatus()
        }
    }

    private var header: some View {
        HStack(spacing: DSSpacing.md) {
            Text("Settings")
                .font(DSFont.Display.lg())
                .foregroundStyle(DSColor.Text.primary)
            Spacer()
            IconButton(icon: "xmark", size: 30, action: onDismiss)
        }
        .padding(.horizontal, DSSpacing.xxl)
        .padding(.vertical, DSSpacing.lg)
    }

    // MARK: - Sources

    private var sourcesSection: some View {
        Section(title: "Sources", subtitle: "Choose which camera and microphone Loomola records.") {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                FieldPicker(
                    label: "Camera",
                    placeholder: "System default",
                    icon: "camera",
                    options: viewModel.captureSources.cameras.map { .init(id: $0.id, title: $0.name) },
                    selection: Binding(
                        get: { viewModel.selectedCameraDeviceID },
                        set: { viewModel.setSelectedCameraDevice(id: $0) }
                    )
                )
                FieldPicker(
                    label: "Microphone",
                    placeholder: "System default",
                    icon: "mic",
                    options: viewModel.captureSources.microphones.map { .init(id: $0.id, title: $0.name) },
                    selection: Binding(
                        get: { viewModel.selectedMicDeviceID },
                        set: { viewModel.setSelectedMicDevice(id: $0) }
                    )
                )
                HStack {
                    Spacer()
                    SecondaryButton("Refresh sources", icon: "arrow.clockwise") {
                        viewModel.refreshCaptureSources()
                    }
                }
            }
        }
    }

    // MARK: - Permissions

    private var permissionsSection: some View {
        Section(title: "Permissions", subtitle: "macOS access Loomola needs to record.") {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                permissionRow(
                    title: "Camera",
                    state: permissionStatus.camera,
                    onOpen: { PermissionChecker.openSystemSettings(for: .camera) }
                )
                permissionRow(
                    title: "Microphone",
                    state: permissionStatus.microphone,
                    onOpen: { PermissionChecker.openSystemSettings(for: .microphone) }
                )
                permissionRow(
                    title: "Screen recording",
                    state: permissionStatus.screenRecording,
                    onOpen: { PermissionChecker.openSystemSettings(for: .screenRecording) }
                )
                permissionRow(
                    title: "Accessibility (optional)",
                    state: permissionStatus.accessibility,
                    onOpen: { PermissionChecker.openSystemSettings(for: .accessibility) }
                )
            }
        }
    }

    private func permissionRow(
        title: String,
        state: PermissionStatus.State,
        onOpen: @escaping () -> Void
    ) -> some View {
        HStack(spacing: DSSpacing.md) {
            Text(title)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Pill(pillTitle(state), kind: pillKind(state))
            if state != .granted {
                SecondaryButton("Open Settings", icon: "gear", action: onOpen)
            }
        }
        .padding(.vertical, DSSpacing.xs)
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

    // MARK: - Integrations

    private var integrationsSection: some View {
        Section(title: "Integrations", subtitle: "Bridges into your everyday workflow.") {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                integrationRow(
                    title: "Chrome bridge",
                    status: viewModel.nativeMessagingStatus,
                    primary: ("Install", "bolt.horizontal", { viewModel.installNativeMessagingHost() }),
                    primaryDisabled: viewModel.isInstallingNativeMessagingHost,
                    secondary: ("Open extension folder", "folder", { viewModel.openExtensionFolder() })
                )
                Divider().overlay(DSColor.Border.subtle)
                integrationRow(
                    title: "Obsidian",
                    status: "Realtime sync with polling backup.",
                    primary: ("Sync now", "arrow.triangle.2.circlepath", { viewModel.syncPendingObsidianNotes() }),
                    primaryDisabled: false,
                    secondary: nil
                )
            }
        }
    }

    private func integrationRow(
        title: String,
        status: String,
        primary: (String, String, () -> Void),
        primaryDisabled: Bool,
        secondary: (String, String, () -> Void)?
    ) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text(title)
                .font(DSFont.Body.lg())
                .foregroundStyle(DSColor.Text.primary)
            Text(status)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .lineLimit(2)
            HStack(spacing: DSSpacing.sm) {
                PrimaryButton(primary.0, icon: primary.1, action: primary.2)
                    .disabled(primaryDisabled)
                if let secondary {
                    SecondaryButton(secondary.0, icon: secondary.1, action: secondary.2)
                }
            }
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        Section(title: "Account", subtitle: nil) {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                if !viewModel.email.isEmpty {
                    HStack {
                        Text("Signed in as")
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.secondary)
                        Text(viewModel.email)
                            .font(DSFont.Body.md())
                            .foregroundStyle(DSColor.Text.primary)
                    }
                }
                HStack(spacing: DSSpacing.sm) {
                    SecondaryButton("Open library", icon: "rectangle.stack") {
                        if let url = URL(string: "https://loom.dissonance.cloud") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                    SecondaryButton("Sign out", icon: "rectangle.portrait.and.arrow.right") {
                        onDismiss()
                        viewModel.signOut()
                    }
                }
            }
        }
    }

    // MARK: - Diagnostics

    private var diagnosticsSection: some View {
        Section(title: "Diagnostics", subtitle: nil) {
            DisclosureGroup(isExpanded: $diagnosticsExpanded) {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    HStack(spacing: DSSpacing.sm) {
                        SecondaryButton("Test video backend", icon: "checkmark.seal") {
                            viewModel.startAndAbortBackendHandshake()
                        }
                        SecondaryButton("Test audio backend", icon: "checkmark.seal") {
                            viewModel.startAndAbortAudioBackendHandshake()
                        }
                    }
                    if !viewModel.statusMessage.isEmpty {
                        Text(viewModel.statusMessage)
                            .font(DSFont.Mono.body())
                            .foregroundStyle(DSColor.Text.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(DSSpacing.md)
                            .background(DSColor.Bg.subtle, in: RoundedRectangle(cornerRadius: DSRadius.sm))
                    }
                }
                .padding(.top, DSSpacing.md)
            } label: {
                Text("Show developer tools")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
            }
        }
    }
}

/// Section wrapper used by SettingsSheet — title + subtitle + body.
private struct Section<Content: View>: View {
    let title: String
    let subtitle: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                if let subtitle {
                    Text(subtitle)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.secondary)
                }
            }
            content
        }
    }
}
