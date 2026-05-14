import Foundation

enum MarkdownDisplayNormalizer {
    static func normalizeGeneratedNotes(_ markdown: String) -> String {
        let collapsedBold = markdown.replacingOccurrences(
            of: #"(?<!\*)\*\*\*\*([^\n]+?)\*\*\*\*(?!\*)"#,
            with: #"**$1**"#,
            options: .regularExpression
        )
        return convertTablesToBulletLists(in: collapsedBold)
    }

    private static func convertTablesToBulletLists(in markdown: String) -> String {
        let lines = markdown.components(separatedBy: .newlines)
        var output: [String] = []
        var index = 0

        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed == "---" {
                index += 1
                continue
            }

            if index + 1 < lines.count,
               let headers = parseTableRow(lines[index]),
               isTableSeparator(lines[index + 1]) {
                var rows: [[String]] = []
                var cursor = index + 2
                while cursor < lines.count, let row = parseTableRow(lines[cursor]) {
                    if !isSeparatorCells(row) {
                        rows.append(row)
                    }
                    cursor += 1
                }

                if !rows.isEmpty {
                    output.append(contentsOf: rows.map { bulletLine(headers: headers, cells: $0) })
                    index = cursor
                    continue
                }
            }

            output.append(lines[index])
            index += 1
        }

        return output.joined(separator: "\n")
    }

    private static func parseTableRow(_ line: String) -> [String]? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("|") else { return nil }
        let pipeCount = trimmed.filter { $0 == "|" }.count
        guard pipeCount >= 2 else { return nil }

        var body = trimmed
        if body.first == "|" { body.removeFirst() }
        if body.last == "|" { body.removeLast() }

        let cells = body
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        guard cells.count >= 2 else { return nil }
        return cells
    }

    private static func isTableSeparator(_ line: String) -> Bool {
        guard let cells = parseTableRow(line) else { return false }
        return isSeparatorCells(cells)
    }

    private static func isSeparatorCells(_ cells: [String]) -> Bool {
        cells.allSatisfy { cell in
            let normalized = cell.replacingOccurrences(of: " ", with: "")
            return normalized.range(
                of: #"^:?-{3,}:?$"#,
                options: .regularExpression
            ) != nil
        }
    }

    private static func bulletLine(headers: [String], cells: [String]) -> String {
        let paddedCells = headers.indices.map { index in
            index < cells.count ? cells[index] : ""
        }
        let lowerHeaders = headers.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

        if let taskIndex = lowerHeaders.firstIndex(where: { ["task", "action", "item", "next step"].contains($0) }) {
            let task = paddedCells[taskIndex].trimmingCharacters(in: .whitespacesAndNewlines)
            let owner = value(for: ["owner", "who", "assignee"], headers: lowerHeaders, cells: paddedCells)
            let notes = value(for: ["notes", "note", "details", "status"], headers: lowerHeaders, cells: paddedCells)

            var line = "- "
            line += task.isEmpty ? genericPairs(headers: headers, cells: paddedCells).joined(separator: "; ") : "**\(task)**"
            if let owner, !owner.isEmpty {
                line += " (\(owner))"
            }
            if let notes, !notes.isEmpty {
                line += ": \(notes)"
            }
            return line
        }

        let pairs = genericPairs(headers: headers, cells: paddedCells)
        return "- " + (pairs.isEmpty ? paddedCells.joined(separator: "; ") : pairs.joined(separator: "; "))
    }

    private static func value(
        for candidates: [String],
        headers: [String],
        cells: [String]
    ) -> String? {
        guard let index = headers.firstIndex(where: { candidates.contains($0) }),
              index < cells.count else { return nil }
        return cells[index].trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func genericPairs(headers: [String], cells: [String]) -> [String] {
        headers.indices.compactMap { index in
            guard index < cells.count else { return nil }
            let header = headers[index].trimmingCharacters(in: .whitespacesAndNewlines)
            let cell = cells[index].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !header.isEmpty, !cell.isEmpty else { return nil }
            return "**\(header):** \(cell)"
        }
    }
}
