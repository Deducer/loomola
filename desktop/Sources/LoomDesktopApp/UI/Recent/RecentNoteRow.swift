import AppKit
import SwiftUI

/// Granola-shape row for the Recent notes list.
///
/// Layout: `[checkbox] [icon] [title] [folder pill] [time] [⋯]`
///
/// Visibility rules:
///   • icon, title, folder pill, time → always
///   • checkbox → on row hover, OR when this row is selected,
///     OR when any row in the strip is in selection mode
///   • ⋯ menu → on row hover (or while its popover is open)
///
/// The folder pill is **always visible** (Granola pattern). When the
/// note is unfiled it shows a subtle tray glyph; when filed it shows
/// the folder name with a chevron. Click → folder picker popover with
/// search + "+ New folder" inline.
///
/// The ⋯ popover offers Move to folder (re-opens the picker) and
/// Delete. Bulk operations live on the strip's floating action bar
/// when one or more checkboxes are ticked.
struct RecentNoteRow: View {
    let recording: RecentRecording
    let folders: [FolderDTO]
    let isSelected: Bool
    let selectionActive: Bool
    let onOpen: () -> Void
    let onToggleSelected: () -> Void
    let onAssignFolder: (String?) -> Void
    let onCreateFolder: (String) async -> FolderDTO?
    let onDelete: () -> Void

    @State private var hovering = false
    @State private var showFolderPicker = false
    @State private var showRowMenu = false

    private var checkboxVisible: Bool {
        hovering || isSelected || selectionActive
    }

    private var rowMenuVisible: Bool {
        hovering || showRowMenu
    }

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            checkbox
                .frame(width: 16)
                .opacity(checkboxVisible ? 1 : 0)

            // Click target for "open the note" — icon + title only.
            // Splitting hit regions like this so the folder pill,
            // ⋯ menu, and checkbox can each own their clicks
            // without the row-wide overlay swallowing them.
            HStack(spacing: DSSpacing.md) {
                iconView
                    .frame(width: 32, height: 32)
                    .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous))
                Text(recording.title)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
            .overlay { ActionHitArea(action: onOpen) }

            folderPill

            Text(timeOfDay)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .monospacedDigit()
                .frame(width: 60, alignment: .trailing)

            rowMenuButton
                .frame(width: 20)
                .opacity(rowMenuVisible ? 1 : 0)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .frame(height: 52)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(rowBackground)
        )
        .onHover { hovering = $0 }
        .animation(LoomolaMotion.quick, value: hovering)
        .animation(LoomolaMotion.quick, value: isSelected)
    }

    private var rowBackground: Color {
        if isSelected { return DSColor.Bg.subtle }
        if hovering { return DSColor.Bg.subtle.opacity(0.7) }
        return Color.clear
    }

    // MARK: - Pieces

    @ViewBuilder
    private var iconView: some View {
        if let url = recording.thumbnailURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFill()
                default: paperIcon
                }
            }
        } else {
            paperIcon
        }
    }

    private var paperIcon: some View {
        ZStack {
            Rectangle().fill(DSColor.Bg.subtle)
            Image(systemName: "doc.text")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
        }
    }

    private var checkbox: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(isSelected ? DSColor.Accent.primary : Color.clear)
                .overlay {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(
                            isSelected ? DSColor.Accent.primary : DSColor.Border.strong,
                            lineWidth: 1.5
                        )
                }
                .frame(width: 16, height: 16)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: onToggleSelected) }
    }

    // MARK: - Folder pill

    private var folderPill: some View {
        HStack(spacing: 4) {
            Image(systemName: recording.folderId == nil ? "tray" : "folder")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(folderPillForeground)
            if let name = recording.folderName, !name.isEmpty {
                Text(name)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(folderPillForeground)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            // Chevron only when hovering — keeps the unfiled / filed
            // pill visually quiet at rest, surfaces "this is clickable"
            // on hover. Granola does the same.
            if hovering {
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(DSColor.Text.tertiary)
            }
        }
        .padding(.horizontal, recording.folderName == nil ? 8 : DSSpacing.sm)
        .padding(.vertical, 4)
        .frame(maxWidth: 160)
        .fixedSize(horizontal: true, vertical: false)
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

    private var folderPillForeground: Color {
        recording.folderId == nil ? DSColor.Text.tertiary : DSColor.Text.secondary
    }

    // MARK: - Per-row ⋯ menu

    private var rowMenuButton: some View {
        Image(systemName: "ellipsis")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(DSColor.Text.tertiary)
            .frame(width: 20, height: 20)
            .contentShape(Rectangle())
            .overlay {
                ActionHitArea {
                    showRowMenu.toggle()
                }
            }
            .popover(isPresented: $showRowMenu, arrowEdge: .bottom) {
                RecentRowMenu(
                    onMoveToFolder: {
                        showRowMenu = false
                        showFolderPicker = true
                    },
                    onDelete: {
                        showRowMenu = false
                        onDelete()
                    }
                )
            }
    }

    private var timeOfDay: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: recording.createdAt)
    }
}

/// Tiny popover menu rendered next to a row's ⋯ button. Two items
/// for v1 — Move to folder and Delete. More slots (Pin, Copy link,
/// Share) land alongside their backing endpoints.
private struct RecentRowMenu: View {
    let onMoveToFolder: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
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
        MenuItemRow(label: label, systemImage: systemImage, tint: tint, action: action)
    }
}

private struct MenuItemRow: View {
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
