// Snapshot + parse the Granola desktop app's local cache.
//
// The cache file (`cache-v4.json`, with `cache-v3.json` fallback) lives
// at `~/Library/Application Support/Granola/`. We copy it to `/tmp`
// before parsing so we don't trip over a torn read if Granola is open
// and writing concurrently.

import {
  copyFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GranolaCacheSnapshot,
  GranolaCacheDoc,
  GranolaCachedTranscript,
  GranolaCacheList,
  GranolaCachePerson,
} from "./types";

const GRANOLA_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "Granola"
);

// Candidate cache filenames in newest-first order. Granola has bumped
// the cache version several times (v3 → v4 → v5 → v6 …); we try each
// in order and use the first plaintext .json that exists. The .enc
// variants alongside (e.g., cache-v6.json.enc) are encrypted and not
// supported in v1 — open Granola.app to re-write the plaintext copy.
const CACHE_CANDIDATES: ReadonlyArray<{ file: string; version: number }> = [
  { file: "cache-v6.json", version: 6 },
  { file: "cache-v5.json", version: 5 },
  { file: "cache-v4.json", version: 4 },
  { file: "cache-v3.json", version: 3 },
];

export function snapshotAndReadCache(runId: string): GranolaCacheSnapshot {
  let chosen: { path: string; version: number } | null = null;
  for (const c of CACHE_CANDIDATES) {
    const p = join(GRANOLA_DIR, c.file);
    if (existsSync(p)) {
      chosen = { path: p, version: c.version };
      break;
    }
  }
  if (!chosen) {
    throw new Error(
      `Granola cache not found in ${GRANOLA_DIR} ` +
        `(looked for ${CACHE_CANDIDATES.map((c) => c.file).join(", ")}). ` +
        `Open Granola.app once and sign in to populate.`
    );
  }
  const tmp = join(tmpdir(), `loomola-migrate-cache-${runId}.json`);
  mkdirSync(tmpdir(), { recursive: true });
  copyFileSync(chosen.path, tmp);
  const raw = JSON.parse(readFileSync(tmp, "utf8"));
  return parseCacheRoot(raw, chosen.version);
}

export function parseCacheRoot(
  raw: unknown,
  version: number
): GranolaCacheSnapshot {
  // Granola wraps the actual data variably across cache-v* releases:
  // sometimes raw.cache.value (string-encoded), sometimes raw.cache,
  // sometimes the root itself. Normalize.
  let inner: any = (raw as any)?.cache?.value ?? (raw as any)?.cache ?? raw;
  if (typeof inner === "string") {
    try {
      inner = JSON.parse(inner);
    } catch {
      // leave as-is — fail below
    }
  }
  const documents: GranolaCacheDoc[] = Array.isArray(inner?.documents)
    ? inner.documents
    : [];
  const transcripts: GranolaCachedTranscript[] = Array.isArray(
    inner?.transcripts
  )
    ? inner.transcripts
    : [];
  const lists: GranolaCacheList[] = Array.isArray(inner?.documentLists)
    ? inner.documentLists
    : Array.isArray(inner?.document_lists)
      ? inner.document_lists
      : [];
  const people: GranolaCachePerson[] = Array.isArray(inner?.people)
    ? inner.people
    : [];

  const transcriptsByDocId: Record<string, GranolaCachedTranscript> = {};
  for (const t of transcripts) {
    transcriptsByDocId[t.document_id] = t;
  }

  const self = inner?.self ?? inner?.user ?? null;
  if (!self?.id || !self?.email) {
    throw new Error(
      "Granola cache missing self user. Open Granola.app to refresh."
    );
  }

  return {
    self: { id: self.id, email: self.email },
    documents,
    transcriptsByDocId,
    documentLists: lists,
    people,
    cacheVersion: version,
  };
}
