import AppKit
import SwiftUI

/// Granola-style row for the Recent notes list (audio mode).
///
/// Layout: icon → title → folder pill → time of day. The folder
/// pill on the right (between title and time) is hidden until row
/// hover, then fades in showing the current folder name (or
/// "Unfiled" with a tray icon). Clicking the pill opens a folder
/// picker popover that assigns the note to a folder via a single
/// PATCH round trip.
///
/// Time of day shows in the right column (e.g., "10:08 AM"); the
/// date is already established by the section header above the row
/// (Today / Yesterday / Mon, May 4 / etc.).
struct RecentNoteRow: View {
    let recording: RecentRecording
    let folders: [FolderDTO]
    let onOpen: () -> Void
    let onAssignFolder: (String?) -> Void

    @State private var hovering = false
    @State private var showFolderPicker = false

    var body: some View {
        HStack(spacing: DSSpacing.md) {
            // Icon + title is the "open the note" click target.
            // Splitting the click regions this way is intentional:
            // a row-wide ActionHitArea overlay would sit on top of
            // the folder pill's own ActionHitArea (NSButton hit-test
            // resolves by render order, not nesting), so pill
            // clicks would open the note instead of the popover.
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
                .opacity(hovering || recording.folderId != nil ? 1 : 0)
                .animation(LoomolaMotion.quick, value: hovering)

            Text(timeOfDay)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .monospacedDigit()
                .frame(width: 64, alignment: .trailing)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .frame(height: 52)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(hovering ? DSColor.Bg.subtle : Color.clear)
        )
        .onHover { hovering = $0 }
        .animation(LoomolaMotion.quick, value: hovering)
    }

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

    private var folderPill: some View {
        HStack(spacing: 4) {
            Image(systemName: recording.folderId == nil ? "tray" : "folder")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DSColor.Text.secondary)
            Text(recording.folderName ?? "Unfiled")
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(DSColor.Text.tertiary)
        }
        .padding(.horizontal, DSSpacing.sm)
        .padding(.vertical, 4)
        .frame(maxWidth: 160)
        .fixedSize(horizontal: true, vertical: false)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .fill(DSColor.Bg.surface)
        )
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
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
                selectedFolderId: recording.folderId
            ) { newFolderId in
                showFolderPicker = false
                onAssignFolder(newFolderId)
            }
        }
    }

    private var timeOfDay: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: recording.createdAt)
    }
}
