import Foundation

/// Row layout for the Granola-shape folder popover (parity rank 10):
/// favourites first, collapsed to `limit` rows behind "Show N more",
/// then the rest. Pure so the collapse maths is testable.
enum FolderPickerRow: Equatable {
    case folder(FolderDTO)
    case showMore(remaining: Int)
}

enum FolderPickerRows {
    static func build(
        folders: [FolderDTO],
        limit: Int = 3,
        expanded: Bool = false
    ) -> [FolderPickerRow] {
        let sorted = folders.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        let favourites = sorted.filter(\.favorite)
        let rest = sorted.filter { !$0.favorite }
        // Favourites lead; without any, the plain list gets the
        // same collapse so a long folder list stays a short popover.
        let leading = favourites.isEmpty ? rest : favourites
        let trailing = favourites.isEmpty ? [] : rest

        var rows: [FolderPickerRow] = []
        if expanded || leading.count <= limit {
            rows += leading.map(FolderPickerRow.folder)
        } else {
            rows += leading.prefix(limit).map(FolderPickerRow.folder)
            rows.append(.showMore(remaining: leading.count - limit))
        }
        rows += trailing.map(FolderPickerRow.folder)
        return rows
    }
}
