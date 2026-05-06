import SwiftUI

/// Granola-shape folder picker. Search input at top, "Unfiled"
/// option above the folder list, current selection has a checkmark,
/// inline "+ New folder" action at the bottom that creates a folder
/// and immediately assigns the recording to it.
///
/// Single-folder for v1 — the multi-folder migration is in Phase 1
/// (dual-write only); the read-flip + multi-select UX lands when
/// Phase 2 ships. Picking a folder today *moves* the recording.
struct FolderPickerPopover: View {
    let folders: [FolderDTO]
    let selectedFolderId: String?
    let onSelect: (String?) -> Void
    let onCreate: (String) async -> FolderDTO?

    @State private var query: String = ""
    @State private var creating = false
    @FocusState private var searchFocused: Bool

    private var filtered: [FolderDTO] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let sorted = folders.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        if trimmed.isEmpty { return sorted }
        return sorted.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    private var canCreate: Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        // Don't offer "+ New folder 'foo'" if a folder named exactly
        // 'foo' (case-insensitive) already exists — picking it is the
        // right action there.
        return !folders.contains(where: { $0.name.localizedCaseInsensitiveCompare(trimmed) == .orderedSame })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            searchField
            Divider().overlay(DSColor.Border.subtle)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        row(label: "Unfiled", folderId: nil, isSelected: selectedFolderId == nil)
                        if !filtered.isEmpty {
                            Divider().overlay(DSColor.Border.subtle).padding(.vertical, 4)
                        }
                    }
                    ForEach(filtered) { folder in
                        row(
                            label: folder.name,
                            folderId: folder.id,
                            isSelected: selectedFolderId == folder.id
                        )
                    }
                    if filtered.isEmpty && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("No folders yet")
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.tertiary)
                            .padding(.horizontal, DSSpacing.md)
                            .padding(.vertical, DSSpacing.sm)
                    }
                }
                .padding(.vertical, DSSpacing.xs)
            }
            .frame(maxHeight: 280)
            if canCreate {
                Divider().overlay(DSColor.Border.subtle)
                createRow
            }
        }
        .frame(width: 280)
        .background(DSColor.Bg.surfaceRaised)
        .onAppear { searchFocused = true }
    }

    private var searchField: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
            TextField("Search folders", text: $query)
                .textFieldStyle(.plain)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .focused($searchFocused)
                .tint(DSColor.Accent.primary)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(DSColor.Text.tertiary)
                }
                .buttonStyle(.plain)
            }
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

    private var createRow: some View {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return HStack(spacing: DSSpacing.sm) {
            Image(systemName: creating ? "hourglass" : "plus.circle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DSColor.Accent.primary)
            Text("New folder ")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Accent.primary)
            + Text("\u{201C}\(trimmed)\u{201D}")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .contentShape(Rectangle())
        .overlay {
            ActionHitArea(isEnabled: !creating) {
                guard !creating else { return }
                creating = true
                Task {
                    let folder = await onCreate(trimmed)
                    creating = false
                    if let folder {
                        // Auto-assign and dismiss.
                        onSelect(folder.id)
                    }
                }
            }
        }
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
