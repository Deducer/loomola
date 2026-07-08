import AppKit
import SwiftUI

/// One card in the Recent recordings grid (video mode). Shows a
/// 16:9 thumbnail with a subtle border and shadow, then title +
/// relative timestamp. Click → opens the share page.
///
/// The border + shadow are deliberate: dark thumbnails (anything on a
/// black background) blend into the canvas without a visible edge.
/// The shadow gives them lift; the border keeps the silhouette
/// readable when the shadow is subtle.
struct RecentCard: View {
    let recording: RecentRecording
    let folders: [FolderDTO]
    let isSelected: Bool
    let selectionActive: Bool
    let onOpen: () -> Void
    let onToggleSelected: () -> Void
    let onAssignFolder: (String?) -> Void
    let onCreateFolder: (String) async -> FolderDTO?
    let onDelete: () -> Void
    let onCopyLink: () -> Void

    @State private var hovering = false
    @State private var showFolderPicker = false
    @State private var showCardMenu = false

    // Cards fill whatever column the grid gives them (16:9 thumbnail).
    // They were fixed at 264pt, sized for a 920–1080pt window with NO
    // sidebar — once the Spaces sidebar landed, the fixed 3-card row
    // overflowed the window and the centered overflow clipped the
    // sidebar's leading edge in video mode.
    private var checkboxVisible: Bool {
        hovering || isSelected || selectionActive
    }

    private var cardMenuVisible: Bool {
        hovering || showCardMenu
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            thumbnail
                .frame(maxWidth: .infinity)
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
                }
                .dsShadow(hovering ? .raised : .subtle)
                .contentShape(Rectangle())
                .overlay { ActionHitArea(action: onOpen) }
                .overlay(alignment: .topLeading) {
                    checkbox
                        .padding(DSSpacing.sm)
                        .opacity(checkboxVisible ? 1 : 0)
                }
                .overlay(alignment: .topTrailing) {
                    cardMenuButton
                        .padding(DSSpacing.sm)
                        .opacity(cardMenuVisible ? 1 : 0)
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(recording.title)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .contentShape(Rectangle())
                    .overlay { ActionHitArea(action: onOpen) }
                HStack(spacing: DSSpacing.sm) {
                    Text(relativeTimestamp)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.secondary)
                    folderPill
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onHover { hovering = $0 }
        .scaleEffect(hovering ? 1.015 : 1.0)
        .animation(LoomolaMotion.quick, value: hovering)
        .animation(LoomolaMotion.quick, value: isSelected)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let url = recording.thumbnailURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .empty: placeholder
                case .success(let image): image.resizable().scaledToFill()
                case .failure: placeholder
                @unknown default: placeholder
                }
            }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        ZStack {
            Rectangle().fill(DSColor.Bg.subtle)
            Image(systemName: recording.kind == .audio ? "waveform" : "video")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
        }
    }

    private var checkbox: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(isSelected ? DSColor.Accent.primary : DSColor.Bg.surfaceRaised.opacity(0.92))
                .overlay {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(
                            isSelected ? DSColor.Accent.primary : DSColor.Border.strong,
                            lineWidth: 1.5
                        )
                }
                .frame(width: 18, height: 18)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: onToggleSelected) }
    }

    private var cardMenuButton: some View {
        Image(systemName: "ellipsis")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(DSColor.Text.secondary)
            .frame(width: 28, height: 28)
            .background(DSColor.Bg.surfaceRaised.opacity(0.94), in: Circle())
            .overlay {
                Circle().strokeBorder(DSColor.Border.subtle, lineWidth: 1)
            }
            .contentShape(Circle())
            .overlay {
                ActionHitArea {
                    showCardMenu.toggle()
                }
            }
            .popover(isPresented: $showCardMenu, arrowEdge: .bottom) {
                RecentCardMenu(
                    onCopyLink: {
                        showCardMenu = false
                        onCopyLink()
                    },
                    onMoveToFolder: {
                        showCardMenu = false
                        showFolderPicker = true
                    },
                    onDelete: {
                        showCardMenu = false
                        onDelete()
                    }
                )
            }
    }

    private var folderPill: some View {
        HStack(spacing: 4) {
            Image(systemName: recording.folderId == nil ? "tray" : "folder")
                .font(.system(size: 10, weight: .medium))
            if let name = recording.folderName, !name.isEmpty {
                Text(name)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .font(DSFont.Body.sm())
        .foregroundStyle(recording.folderId == nil ? DSColor.Text.tertiary : DSColor.Text.secondary)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .frame(maxWidth: 118)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .fill(hovering ? DSColor.Bg.surfaceRaised : Color.clear)
        )
        .contentShape(Rectangle())
        .overlay {
            ActionHitArea {
                showFolderPicker.toggle()
            }
        }
        .help(recording.folderName ?? "Unfiled")
        .popover(isPresented: $showFolderPicker, arrowEdge: .bottom) {
            FolderPickerPopover(
                folders: folders,
                selectedFolderId: recording.folderId,
                onSelect: { newFolderId in
                    showFolderPicker = false
                    onAssignFolder(newFolderId)
                },
                onCreate: { name in
                    await onCreateFolder(name)
                }
            )
        }
    }

    private var relativeTimestamp: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: recording.createdAt, relativeTo: Date())
    }
}

private struct RecentCardMenu: View {
    let onCopyLink: () -> Void
    let onMoveToFolder: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            menuItem(
                label: "Copy link",
                systemImage: "link",
                tint: DSColor.Text.primary,
                action: onCopyLink
            )
            Divider().overlay(DSColor.Border.subtle)
            menuItem(
                label: "Move to folder",
                systemImage: "folder",
                tint: DSColor.Text.primary,
                action: onMoveToFolder
            )
            Divider().overlay(DSColor.Border.subtle)
            menuItem(
                label: "Delete",
                systemImage: "trash",
                tint: DSColor.State.danger,
                action: onDelete
            )
        }
        .frame(width: 200)
        .background(DSColor.Bg.surfaceRaised)
    }

    private func menuItem(
        label: String,
        systemImage: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        RecentCardMenuItem(label: label, systemImage: systemImage, tint: tint, action: action)
    }
}

private struct RecentCardMenuItem: View {
    let label: String
    let systemImage: String
    let tint: Color
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 16)
            Text(label)
                .font(DSFont.Body.md())
                .foregroundStyle(tint)
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(hovering ? DSColor.Bg.subtle : Color.clear)
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: action) }
        .onHover { hovering = $0 }
    }
}
