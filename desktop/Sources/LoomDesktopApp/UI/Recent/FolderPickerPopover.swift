import SwiftUI

/// Granola-shape folder picker (parity rank 10): search on top, a
/// locked "My notes" row for unfiled, favourites with note counts
/// collapsed behind "Show N more", the rest below, and a lime "New
/// folder" row at the bottom.
///
/// Single-folder for v1 — the multi-folder migration is in Phase 1
/// (dual-write only); picking a folder today *moves* the recording.
struct FolderPickerPopover: View {
    let folders: [FolderDTO]
    let selectedFolderId: String?
    let onSelect: (String?) -> Void
    let onCreate: (String) async -> FolderDTO?

    @State private var query: String = ""
    @State private var creating = false
    @State private var namingNewFolder = false
    @State private var expanded = false
    @FocusState private var searchFocused: Bool

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var filtered: [FolderDTO] {
        guard !trimmedQuery.isEmpty else { return folders }
        return folders.filter { $0.name.localizedCaseInsensitiveContains(trimmedQuery) }
    }

    private var rows: [FolderPickerRow] {
        FolderPickerRows.build(folders: filtered, limit: 3, expanded: expanded || !trimmedQuery.isEmpty)
    }

    private var canCreate: Bool {
        guard !trimmedQuery.isEmpty else { return false }
        return !folders.contains(where: { $0.name.localizedCaseInsensitiveCompare(trimmedQuery) == .orderedSame })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            searchField
            Divider().overlay(DSColor.Border.subtle)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if trimmedQuery.isEmpty {
                        FolderPickerRowView(
                            label: "My notes",
                            icon: "lock",
                            count: nil,
                            isSelected: selectedFolderId == nil
                        ) { onSelect(nil) }
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        switch row {
                        case .folder(let folder):
                            FolderPickerRowView(
                                label: folder.name,
                                icon: folder.icon == nil ? "folder.fill" : nil,
                                emoji: folder.icon,
                                count: folder.recordingCount,
                                isSelected: selectedFolderId == folder.id
                            ) { onSelect(folder.id) }
                        case .showMore(let remaining):
                            showMoreRow(remaining: remaining)
                        }
                    }
                    if folders.isEmpty && trimmedQuery.isEmpty {
                        Text("No folders yet")
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.tertiary)
                            .padding(.horizontal, DSSpacing.md)
                            .padding(.vertical, DSSpacing.sm)
                    }
                }
                .padding(.vertical, DSSpacing.xs)
            }
            .frame(maxHeight: 300)
            Divider().overlay(DSColor.Border.subtle)
            newFolderRow
        }
        .frame(width: 284)
        .background(DSColor.Bg.surfaceRaised)
        .onAppear { searchFocused = true }
    }

    private var searchField: some View {
        HStack(spacing: DSSpacing.sm) {
            TextField(namingNewFolder ? "New folder name" : "Search", text: $query)
                .textFieldStyle(.plain)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .focused($searchFocused)
                .tint(DSColor.Accent.primary)
                .onSubmit {
                    if canCreate { createFolder() }
                }
            if query.isEmpty {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DSColor.Text.tertiary)
            } else {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(DSColor.Text.tertiary)
                    .contentShape(Rectangle())
                    .overlay { ActionHitArea { query = ""; namingNewFolder = false } }
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 10)
    }

    private func showMoreRow(remaining: Int) -> some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "chevron.down")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DSColor.Text.tertiary)
                .frame(width: 16)
            Text("Show \(remaining) more")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 7)
        .contentShape(Rectangle())
        .overlay { ActionHitArea { expanded = true } }
    }

    /// Lime "New folder": with a typed name it creates that folder;
    /// otherwise it turns the search field into the name field.
    private var newFolderRow: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: creating ? "hourglass" : "folder.badge.plus")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.Accent.ai)
                .frame(width: 16)
            if canCreate {
                Text("New folder ")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Accent.ai)
                + Text("\u{201C}\(trimmedQuery)\u{201D}")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
            } else {
                Text("New folder")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Accent.ai)
            }
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .overlay {
            ActionHitArea(isEnabled: !creating) {
                if canCreate {
                    createFolder()
                } else {
                    namingNewFolder = true
                    searchFocused = true
                }
            }
        }
    }

    private func createFolder() {
        guard !creating, canCreate else { return }
        let name = trimmedQuery
        creating = true
        Task {
            let folder = await onCreate(name)
            creating = false
            namingNewFolder = false
            if let folder {
                // Auto-assign and dismiss.
                onSelect(folder.id)
            }
        }
    }
}

private struct FolderPickerRowView: View {
    let label: String
    var icon: String? = nil
    var emoji: String? = nil
    let count: Int?
    let isSelected: Bool
    let onSelect: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Group {
                if let emoji {
                    Text(emoji).font(.system(size: 13))
                } else {
                    Image(systemName: icon ?? "folder.fill")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(DSColor.Text.tertiary)
                }
            }
            .frame(width: 16)
            Text(label)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .lineLimit(1)
            Spacer()
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.Accent.ai)
            } else if let count {
                Text("\(count)")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 7)
        .background(hovering ? DSColor.Bg.subtle : Color.clear)
        .contentShape(Rectangle())
        .overlay {
            ActionHitArea {
                if !isSelected { onSelect() }
            }
        }
        .onHover { hovering = $0 }
    }
}
