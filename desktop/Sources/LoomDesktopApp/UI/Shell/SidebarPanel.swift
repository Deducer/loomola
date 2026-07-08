import SwiftUI

/// Granola-shape sidebar. Slides in from the left when the user clicks
/// the sidebar toggle in the title bar (or presses ⌘S). The home shell
/// reserves this rail while open, so content is never hidden underneath it.
///
/// Sections:
///   • Search field at top.
///   • Home — clears any folder filter.
///   • Favorites — pinned folders (`folders.is_favorite`), Granola
///     pattern. Right-click any folder to pin/unpin or set an emoji.
///   • Spaces — the remaining folders, alphabetical.
///
/// Deferred to a follow-up pass:
///   • Shared with me / Chat top-level items
///   • People + Companies bottom rail
///   • Workspace switcher at bottom
struct SidebarPanel: View {
    let folders: [FolderDTO]
    @Binding var query: String
    @Binding var selectedFolderId: String?
    let topPadding: CGFloat
    let onClose: () -> Void
    let onToggleFavorite: (FolderDTO) -> Void
    let onSetIcon: (FolderDTO, String?) -> Void

    @FocusState private var searchFocused: Bool
    @State private var emojiEditingFolder: FolderDTO?
    @State private var emojiDraft = ""

    private var filteredFolders: [FolderDTO] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let sorted = folders.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        if trimmed.isEmpty { return sorted }
        return sorted.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    private var favoriteFolders: [FolderDTO] {
        filteredFolders.filter(\.favorite)
    }

    private var regularFolders: [FolderDTO] {
        filteredFolders.filter { !$0.favorite }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            searchField
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, topPadding)
                .padding(.bottom, DSSpacing.sm)

            navList
        }
        .frame(width: WindowChromeLayout.sidebarWidth)
        .frame(maxHeight: .infinity)
        .background(DSColor.Bg.canvas)
        .overlay(alignment: .trailing) {
            // Hairline separator on the right edge — Granola has a
            // very faint vertical line where the sidebar meets the
            // content. Only visible against the canvas, not on top
            // of cards.
            Rectangle()
                .fill(DSColor.Border.subtle)
                .frame(width: 1)
        }
    }

    private var searchField: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
            TextField("Search", text: $query)
                .textFieldStyle(.plain)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .focused($searchFocused)
                .tint(DSColor.Accent.primary)
            Text("⌘K")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.tertiary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DSColor.Bg.subtle)
                )
        }
        .padding(.horizontal, DSSpacing.sm)
        .padding(.vertical, DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.Bg.subtle)
        )
        .onTapGesture {
            searchFocused = true
        }
    }

    private var navList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                primaryNav
                if !favoriteFolders.isEmpty {
                    folderSection(title: "Favorites", sectionFolders: favoriteFolders)
                }
                folderSection(title: "Spaces", sectionFolders: regularFolders)
            }
            .padding(.horizontal, DSSpacing.sm)
            .padding(.top, DSSpacing.xs)
            .padding(.bottom, DSSpacing.lg)
        }
        .popover(item: $emojiEditingFolder, arrowEdge: .trailing) { folder in
            emojiEditor(for: folder)
        }
    }

    private func emojiEditor(for folder: FolderDTO) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text("Emoji for \(folder.name)")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
            HStack(spacing: DSSpacing.sm) {
                TextField("🎯", text: $emojiDraft)
                    .textFieldStyle(.plain)
                    .font(.system(size: 20))
                    .frame(width: 56)
                    .padding(6)
                    .background(
                        RoundedRectangle(cornerRadius: DSRadius.sm)
                            .fill(DSColor.Bg.subtle)
                    )
                    .onSubmit { commitEmoji(for: folder) }
                Button("Set") { commitEmoji(for: folder) }
                    .buttonStyle(.plain)
                    .font(DSFont.Body.sm().weight(.medium))
                    .foregroundStyle(DSColor.Accent.primary)
            }
            Text("Tip: press fn (🌐) for the emoji picker")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.tertiary)
        }
        .padding(DSSpacing.md)
        .frame(width: 230)
    }

    private func commitEmoji(for folder: FolderDTO) {
        let trimmed = emojiDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        onSetIcon(folder, trimmed.isEmpty ? nil : String(trimmed.prefix(2)))
        emojiEditingFolder = nil
        emojiDraft = ""
    }

    private var primaryNav: some View {
        VStack(alignment: .leading, spacing: 2) {
            navItem(
                label: "Home",
                systemImage: "house",
                isActive: selectedFolderId == nil,
                action: {
                    selectedFolderId = nil
                    onClose()
                }
            )
        }
    }

    private func folderSection(title: String, sectionFolders: [FolderDTO]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.tertiary)
                .padding(.horizontal, DSSpacing.sm)
                .padding(.vertical, 4)

            if sectionFolders.isEmpty {
                Text(query.isEmpty ? "No folders yet" : "No matches")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .padding(.horizontal, DSSpacing.sm)
                    .padding(.vertical, DSSpacing.sm)
            } else {
                ForEach(sectionFolders) { folder in
                    SidebarNavRow(
                        label: folder.name,
                        systemImage: "folder",
                        emoji: folder.icon,
                        isActive: selectedFolderId == folder.id,
                        action: {
                            selectedFolderId = folder.id
                            onClose()
                        }
                    )
                    .contextMenu {
                        Button(folder.favorite ? "Remove from Favorites" : "Add to Favorites") {
                            onToggleFavorite(folder)
                        }
                        Button(folder.icon == nil ? "Set emoji…" : "Change emoji…") {
                            emojiDraft = folder.icon ?? ""
                            emojiEditingFolder = folder
                        }
                        if folder.icon != nil {
                            Button("Clear emoji") {
                                onSetIcon(folder, nil)
                            }
                        }
                    }
                }
            }
        }
    }

    private func navItem(
        label: String,
        systemImage: String,
        isActive: Bool,
        action: @escaping () -> Void
    ) -> some View {
        SidebarNavRow(
            label: label,
            systemImage: systemImage,
            isActive: isActive,
            action: action
        )
    }
}

private struct SidebarNavRow: View {
    let label: String
    let systemImage: String
    var emoji: String? = nil
    let isActive: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            if let emoji, !emoji.isEmpty {
                Text(emoji)
                    .font(.system(size: 13))
                    .frame(width: 18)
            } else {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(isActive ? DSColor.Text.primary : DSColor.Text.secondary)
                    .frame(width: 18)
            }
            Text(label)
                .font(DSFont.Body.md())
                .foregroundStyle(isActive ? DSColor.Text.primary : DSColor.Text.secondary)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DSSpacing.sm)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .fill(rowBackground)
        )
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: action) }
        .onHover { hovering = $0 }
    }

    private var rowBackground: Color {
        if isActive { return DSColor.Bg.subtle }
        if hovering { return DSColor.Bg.subtle.opacity(0.5) }
        return Color.clear
    }
}
