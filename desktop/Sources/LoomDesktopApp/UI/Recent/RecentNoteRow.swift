import AppKit
import SwiftUI

/// Granola-shape row for the Recent notes list (parity rank 2).
///
/// Layout: `[checkbox] [icon] [title / attendees] [suggestion or folder] [time] [⋯]`
///
/// Visibility rules:
///   • icon, title, attendee subtitle, time → always
///   • "Add to ▸ Folder ✓ ✕" suggestion pill → while the note is
///     unfiled and the AI suggestion is pending
///   • folder icon + name → when filed
///   • checkbox → on row hover, OR when this row is selected,
///     OR when any row in the strip is in selection mode
///   • ⋯ menu → on row hover (or while its popover is open)
struct RecentNoteRow: View {
    let recording: RecentRecording
    let folders: [FolderDTO]
    let isSelected: Bool
    let selectionActive: Bool
    let onOpen: () -> Void
    let onToggleSelected: () -> Void
    let onAssignFolder: (String?) -> Void
    let onCreateFolder: (String) async -> FolderDTO?
    let onAcceptSuggestion: () -> Void
    let onDismissSuggestion: () -> Void
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

    private var suggestedFolderName: String? {
        guard recording.folderId == nil, let id = recording.suggestedFolderId else { return nil }
        return folders.first(where: { $0.id == id })?.name
    }

    /// "Me" alone, or "Me, Neely, Bhaskar" — Granola lists the people
    /// under the title.
    private var attendeeLine: String {
        let names = recording.attendees.map(\.name).filter { !$0.isEmpty }
        return (["Me"] + names).joined(separator: ", ")
    }

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            checkbox
                .frame(width: 16)
                .opacity(checkboxVisible ? 1 : 0)

            // Click target for "open the note" — icon + title region.
            HStack(spacing: DSSpacing.md) {
                iconView
                    .frame(width: 32, height: 32)
                    .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(recording.title)
                        .font(DSFont.Body.md())
                        .foregroundStyle(DSColor.Text.primary)
                        .lineLimit(1)
                    Text(attendeeLine)
                        .font(DSFont.Body.sm().weight(.regular))
                        .foregroundStyle(DSColor.Text.tertiary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
            .overlay { ActionHitArea(action: onOpen) }

            if let suggestedFolderName {
                suggestionPill(suggestedFolderName)
            } else {
                folderPill
            }

            timeLabel
                .frame(width: 64, alignment: .trailing)

            rowMenuButton
                .frame(width: 20)
                .opacity(rowMenuVisible ? 1 : 0)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 6)
        .frame(height: 48)
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
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .fill(DSColor.Bg.surface)
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
            Image(systemName: "doc")
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(DSColor.Text.secondary)
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

    /// "9:44 AM" with the period in small caps — Granola's time column.
    private var timeLabel: some View {
        let formatter = RecentDateGrouping.formatter(format: "h:mm", calendar: .current)
        let period = RecentDateGrouping.formatter(format: "a", calendar: .current)
        return (
            Text(formatter.string(from: recording.createdAt))
                .font(DSFont.Body.sm().weight(.regular))
            + Text(" " + period.string(from: recording.createdAt).uppercased())
                .font(.system(size: 9, weight: .medium))
        )
        .foregroundStyle(DSColor.Text.secondary)
        .monospacedDigit()
        .lineLimit(1)
    }

    // MARK: - Suggestion pill ("Add to ▸ Folder ✓ ✕")

    private func suggestionPill(_ name: String) -> some View {
        HStack(spacing: 6) {
            Text("Add to")
                .font(DSFont.Body.sm().weight(.regular))
                .foregroundStyle(DSColor.Text.tertiary)
            HStack(spacing: 4) {
                Image(systemName: "folder")
                    .font(.system(size: 10, weight: .medium))
                Text(name)
                    .font(DSFont.Body.sm())
                    .lineLimit(1)
            }
            .foregroundStyle(DSColor.Text.secondary)
            Image(systemName: "checkmark")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DSColor.Accent.ai)
                .frame(width: 18, height: 18)
                .contentShape(Rectangle())
                .overlay { ActionHitArea(action: onAcceptSuggestion) }
                .help("File in \(name)")
            Image(systemName: "xmark")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DSColor.Text.tertiary)
                .frame(width: 18, height: 18)
                .contentShape(Rectangle())
                .overlay { ActionHitArea(action: onDismissSuggestion) }
                .help("Dismiss suggestion")
        }
        .padding(.leading, DSSpacing.md)
        .padding(.trailing, 6)
        .padding(.vertical, 5)
        .background(
            Capsule().fill(DSColor.Bg.surface)
        )
        .overlay {
            Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    // MARK: - Folder pill (filed notes only; unfiled rows stay quiet)

    @ViewBuilder
    private var folderPill: some View {
        if let name = recording.folderName, !name.isEmpty {
            HStack(spacing: 4) {
                Image(systemName: "folder")
                    .font(.system(size: 11, weight: .medium))
                Text(name)
                    .font(DSFont.Body.sm())
                    .lineLimit(1)
                    .truncationMode(.tail)
                if hovering {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(DSColor.Text.tertiary)
                }
            }
            .foregroundStyle(DSColor.Text.secondary)
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, 4)
            .frame(maxWidth: 160)
            .fixedSize(horizontal: true, vertical: false)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                    .fill(hovering ? DSColor.Bg.surfaceRaised : Color.clear)
            )
            .contentShape(Rectangle())
            .overlay { ActionHitArea { showFolderPicker.toggle() } }
            .help(name)
            .popover(isPresented: $showFolderPicker, arrowEdge: .bottom) { folderPicker }
        } else if hovering || showFolderPicker {
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
                .overlay { ActionHitArea { showFolderPicker.toggle() } }
                .help("Add to folder")
                .popover(isPresented: $showFolderPicker, arrowEdge: .bottom) { folderPicker }
        } else {
            Color.clear.frame(width: 24, height: 24)
        }
    }

    private var folderPicker: some View {
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
