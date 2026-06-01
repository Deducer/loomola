import SwiftUI

/// Granola-shape sidebar. Slides in from the left when the user clicks
/// the sidebar toggle in the title bar (or presses ⌘S). The home shell
/// reserves this rail while open, so content is never hidden underneath it.
///
/// v1 sections (this pass):
///   • Search field at top (cosmetic — wires to query state passed
///     in; the strip already has filtering hooks).
///   • Home — single button at top that clears any folder filter.
///   • Spaces — list of the user's folders, alphabetical, click to
///     filter the Recent strip.
///
/// Deferred to a follow-up pass (each needs schema or a separate
/// product slice):
///   • Favorites section (`folders.is_favorite` schema column)
///   • Custom folder icons + colors (`folders.icon`, `folders.color`)
///   • Shared with me / Chat top-level items
///   • People + Companies bottom rail
///   • Workspace switcher at bottom
struct SidebarPanel: View {
    let folders: [FolderDTO]
    @Binding var query: String
    @Binding var selectedFolderId: String?
    let onClose: () -> Void

    @FocusState private var searchFocused: Bool

    private var filteredFolders: [FolderDTO] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let sorted = folders.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        if trimmed.isEmpty { return sorted }
        return sorted.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            searchField
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.md)
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
                spacesSection
            }
            .padding(.horizontal, DSSpacing.sm)
            .padding(.top, DSSpacing.xs)
            .padding(.bottom, DSSpacing.lg)
        }
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

    private var spacesSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Spaces")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.tertiary)
                .padding(.horizontal, DSSpacing.sm)
                .padding(.vertical, 4)

            if filteredFolders.isEmpty {
                Text(query.isEmpty ? "No folders yet" : "No matches")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .padding(.horizontal, DSSpacing.sm)
                    .padding(.vertical, DSSpacing.sm)
            } else {
                ForEach(filteredFolders) { folder in
                    navItem(
                        label: folder.name,
                        systemImage: "folder",
                        isActive: selectedFolderId == folder.id,
                        action: {
                            selectedFolderId = folder.id
                            onClose()
                        }
                    )
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
    let isActive: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(isActive ? DSColor.Text.primary : DSColor.Text.secondary)
                .frame(width: 18)
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
