import Foundation

/// One choice in the speaker-rename popover.
enum SpeakerRenameRow: Equatable {
    /// Name the voice as an existing person (the People library).
    case person(PersonDTO)
    /// Add the typed name to People, then name the voice as them.
    case createPerson(String)
    /// Label the voice with the typed text on this note only.
    case labelOnly(String)
}

/// What the rename popover offers for a typed query: matching people
/// (this call's attendees first), then, when the typed name is nobody
/// in the library yet, "Add <name>" and "Label as <name>".
enum SpeakerRenameRows {
    static func build(query: String, people: [PersonDTO], attendeeIds: Set<String>) -> [SpeakerRenameRow] {
        let name = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let matching = name.isEmpty
            ? people
            : people.filter { $0.displayName.localizedCaseInsensitiveContains(name) }
        let ordered = matching.sorted { a, b in
            let aAttendee = attendeeIds.contains(a.id)
            let bAttendee = attendeeIds.contains(b.id)
            if aAttendee != bAttendee { return aAttendee }
            return a.displayName.localizedCaseInsensitiveCompare(b.displayName) == .orderedAscending
        }
        var rows = ordered.map(SpeakerRenameRow.person)
        let exact = people.contains { $0.displayName.localizedCaseInsensitiveCompare(name) == .orderedSame }
        if !name.isEmpty, !exact {
            rows.append(.createPerson(name))
            rows.append(.labelOnly(name))
        }
        return rows
    }

    /// Return in the field picks the first row.
    static func submitTarget(query: String, people: [PersonDTO], attendeeIds: Set<String>) -> SpeakerRenameRow? {
        build(query: query, people: people, attendeeIds: attendeeIds).first
    }
}
