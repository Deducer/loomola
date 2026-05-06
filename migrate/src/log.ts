// Pretty terminal output + final summary for the CLI.

const ICONS = {
  ok: "\x1b[32m✓\x1b[0m",
  upd: "\x1b[36m↻\x1b[0m",
  skip: "\x1b[33m⊘\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
};

export type RowStatus = keyof typeof ICONS;

export type Counter = { ok: number; upd: number; skip: number; fail: number };

export function newCounter(): Counter {
  return { ok: 0, upd: 0, skip: 0, fail: 0 };
}

export function logRow(
  index: number,
  total: number,
  status: RowStatus,
  title: string,
  detail?: string
): void {
  const idx = `[${String(index).padStart(3)}/${total}]`;
  const t = title.length > 40 ? `${title.slice(0, 37)}...` : title.padEnd(40);
  const tail = detail ? `  ${detail}` : "";
  console.log(`${idx} ${ICONS[status]} "${t}"${tail}`);
}

export function logSummary(counter: Counter, elapsedMs: number): void {
  const sec = Math.round(elapsedMs / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  console.log(`\nDone in ${m}m ${s}s`);
  console.log(
    `  ${ICONS.ok} created  ${counter.ok}   ${ICONS.upd} updated  ${counter.upd}   ${ICONS.skip} skipped  ${counter.skip}   ${ICONS.fail} failed  ${counter.fail}`
  );
}
