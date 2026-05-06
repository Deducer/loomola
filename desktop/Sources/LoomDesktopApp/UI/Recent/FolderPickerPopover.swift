import SwiftUI

/// Granola-style folder picker shown by clicking a note's folder
/// pill. Lists all of the user's folders (alphabetical) plus an
/// "Unfiled" option at top. Current selection has a checkmark.
/// Clicking a row applies the assignment via the parent's callback
/// and dismisses.
///
/// Single-folder for v1 — Granola's multi-folder checkbox model
/// requires a schema migration we'll do later. For now, picking
/// a folder *moves* the note rather than adding to it.
struct FolderPickerPopover: View {
    let folders: [FolderDTO]
    let selectedFolderId: String?
    let onSelect: (String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(DSColor.Border.subtle)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    row(label: "Unfiled", folderId: nil, isSelected: selectedFolderId == nil)
                    if !folders.isEmpty {
                        Divider()
                            .overlay(DSColor.Border.subtle)
                            .padding(.vertical, 4)
                    }
                    ForEach(folders.sorted(by: { $0.name.localizedCompare($1.name) == .orderedAscending })) { folder in
                        row(
                            label: folder.name,
                            folderId: folder.id,
                            isSelected: selectedFolderId == folder.id
                        )
                    }
                }
                .padding(.vertical, DSSpacing.xs)
            }
            .frame(maxHeight: 320)
        }
        .frame(width: 260)
        .background(DSColor.Bg.surfaceRaised)
    }

    private var header: some View {
        HStack {
            Text("File in folder")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
    }

    private func row(label: String, folderId: String?, isSelected: Bool) -> some View {
        FolderPickerRow(
            label: label,
            folderId: folderId,
            isSelected: isSelected,
            onSelect: onSelect
        )
    }
}

private struct FolderPickerRow: View {
    let label: String
    let folderId: String?
    let isSelected: Bool
    let onSelect: (String?) -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: folderId == nil ? "tray" : "folder")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
                .frame(width: 16)
            Text(label)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .lineLimit(1)
            Spacer()
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.Accent.primary)
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(hovering ? DSColor.Bg.subtle : Color.clear)
        .contentShape(Rectangle())
        .overlay {
            ActionHitArea {
                if !isSelected {
                    onSelect(folderId)
                }
            }
        }
        .onHover { hovering = $0 }
    }
}
