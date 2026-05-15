export function normalizeGeneratedNotesMarkdown(markdown: string): string {
  const collapsedBold = markdown.replace(
    /(?<!\*)\*\*\*\*([^\n]+?)\*\*\*\*(?!\*)/g,
    "**$1**"
  );
  return convertTablesToBulletLists(collapsedBold)
    .replace(/(^|\n)\s*---\s*(?=\n|$)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function convertTablesToBulletLists(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (
      index + 1 < lines.length &&
      parseTableRow(lines[index]) &&
      isTableSeparator(lines[index + 1])
    ) {
      const headers = parseTableRow(lines[index])!;
      const rows: string[][] = [];
      let cursor = index + 2;
      while (cursor < lines.length) {
        const row = parseTableRow(lines[cursor]);
        if (!row) break;
        if (!isSeparatorCells(row)) rows.push(row);
        cursor += 1;
      }

      if (rows.length > 0) {
        output.push(...rows.map((row) => bulletLine(headers, row)));
        index = cursor;
        continue;
      }
    }

    output.push(lines[index]);
    index += 1;
  }

  return output.join("\n");
}

function parseTableRow(line: string | undefined): string[] | null {
  const trimmed = line?.trim() ?? "";
  if (!trimmed.includes("|")) return null;
  if ([...trimmed].filter((char) => char === "|").length < 2) return null;

  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = body.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function isTableSeparator(line: string | undefined): boolean {
  const cells = parseTableRow(line);
  return Boolean(cells && isSeparatorCells(cells));
}

function isSeparatorCells(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function bulletLine(headers: string[], cells: string[]): string {
  const paddedCells = headers.map((_, index) => cells[index]?.trim() ?? "");
  const lowerHeaders = headers.map((header) => header.trim().toLowerCase());
  const taskIndex = lowerHeaders.findIndex((header) =>
    ["task", "action", "item", "next step"].includes(header)
  );

  if (taskIndex >= 0) {
    const task = paddedCells[taskIndex];
    const owner = valueFor(["owner", "who", "assignee"], lowerHeaders, paddedCells);
    const notes = valueFor(["notes", "note", "details", "status"], lowerHeaders, paddedCells);
    const parts = [`- ${task ? `**${task}**` : genericPairs(headers, paddedCells).join("; ")}`];
    if (owner) parts.push(` (${owner})`);
    if (notes) parts.push(`: ${notes}`);
    return parts.join("");
  }

  const pairs = genericPairs(headers, paddedCells);
  return `- ${pairs.length > 0 ? pairs.join("; ") : paddedCells.join("; ")}`;
}

function valueFor(candidates: string[], headers: string[], cells: string[]): string | null {
  const index = headers.findIndex((header) => candidates.includes(header));
  if (index < 0) return null;
  return cells[index]?.trim() || null;
}

function genericPairs(headers: string[], cells: string[]): string[] {
  return headers
    .map((header, index) => {
      const label = header.trim();
      const value = cells[index]?.trim() ?? "";
      return label && value ? `**${label}:** ${value}` : null;
    })
    .filter((value): value is string => Boolean(value));
}
