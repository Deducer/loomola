import SwiftUI

/// "Who is this?" popover on a transcript speaker label. Type a name:
/// matching people from the library come first (attendees on top),
/// then "Add <name>" (a new person, reused on later calls) and "Label
/// as <name>" (this note only). Works with an empty People library —
/// the typed name is always a choice.
struct SpeakerRenamePopover: View {
    let currentName: String
    let people: [PersonDTO]
    let attendeeIds: Set<String>
    /// "Not <name>" / "Remove label" — nil hides the row.
    let clearTitle: String?
    let onPick: (SpeakerRenameRow) -> Void
    let onClear: () -> Void

    @State private var query = ""
    @FocusState private var fieldFocused: Bool

    private var rows: [SpeakerRenameRow] {
        SpeakerRenameRows.build(query: query, people: people, attendeeIds: attendeeIds)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            nameField
            Divider().overlay(DSColor.Border.subtle)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if rows.isEmpty {
                        Text(people.isEmpty ? "Type a name" : "No one matches")
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.tertiary)
                            .padding(.horizontal, DSSpacing.md)
                            .padding(.vertical, DSSpacing.sm)
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        SpeakerRenameRowView(row: row, attendeeIds: attendeeIds) { onPick(row) }
                    }
                }
                .padding(.vertical, DSSpacing.xs)
            }
            .frame(maxHeight: 260)
            if let clearTitle {
                Divider().overlay(DSColor.Border.subtle)
                clearRow(clearTitle)
            }
        }
        .frame(width: 284)
        .background(DSColor.Bg.surfaceRaised)
        .onAppear { fieldFocused = true }
    }

    private var nameField: some View {
        HStack(spacing: DSSpacing.sm) {
            TextField(currentName.hasPrefix("Speaker ") ? "Who is this?" : "Rename \(currentName)", text: $query)
                .textFieldStyle(.plain)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .focused($fieldFocused)
                .tint(DSColor.Accent.primary)
                .onSubmit {
                    if let target = SpeakerRenameRows.submitTarget(query: query, people: people, attendeeIds: attendeeIds) {
                        onPick(target)
                    }
                }
            if query.isEmpty {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DSColor.Text.tertiary)
            } else {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(DSColor.Text.tertiary)
                    .contentShape(Rectangle())
                    .overlay { ActionHitArea { query = "" } }
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 10)
    }

    private func clearRow(_ title: String) -> some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "person.crop.circle.badge.xmark")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.Text.tertiary)
                .frame(width: 16)
            Text(title)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: onClear) }
    }
}

private struct SpeakerRenameRowView: View {
    let row: SpeakerRenameRow
    let attendeeIds: Set<String>
    let onSelect: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(iconColor)
                .frame(width: 16)
            label
                .lineLimit(1)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 7)
        .background(hovering ? DSColor.Bg.subtle : Color.clear)
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: onSelect) }
        .onHover { hovering = $0 }
    }

    private var icon: String {
        switch row {
        case .person(let person): return person.isSelf ? "person.fill" : "person"
        case .createPerson: return "person.badge.plus"
        case .labelOnly: return "tag"
        }
    }

    private var iconColor: Color {
        switch row {
        case .person: return DSColor.Text.tertiary
        case .createPerson: return DSColor.Accent.ai
        case .labelOnly: return DSColor.Text.tertiary
        }
    }

    @ViewBuilder
    private var label: some View {
        switch row {
        case .person(let person):
            Text(person.displayName)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
        case .createPerson(let name):
            Text("Add ")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Accent.ai)
            + Text("\u{201C}\(name)\u{201D}")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
        case .labelOnly(let name):
            Text("Label as ")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.secondary)
            + Text("\u{201C}\(name)\u{201D}")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
        }
    }

    private var trailing: String? {
        switch row {
        case .person(let person):
            if person.isSelf { return "you" }
            return attendeeIds.contains(person.id) ? "attendee" : nil
        case .createPerson: return "to People"
        case .labelOnly: return "this note"
        }
    }
}
