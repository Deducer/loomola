import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCacheRoot } from "../src/granola/cache-reader";

const FIXTURE = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures", "sample-cache.json"),
    "utf8"
  )
);

describe("parseCacheRoot", () => {
  it("extracts self, documents, transcripts, lists, people", () => {
    const snap = parseCacheRoot(FIXTURE, 4);
    expect(snap.self.id).toBe("self-uuid");
    expect(snap.self.email).toBe("test@example.com");
    expect(snap.documents.length).toBe(2);
    expect(snap.documentLists[0]?.name).toBe("Work");
    expect(snap.people[0]?.email).toBe("test@example.com");
    expect(snap.cacheVersion).toBe(4);
  });

  it("indexes transcripts by document id", () => {
    const snap = parseCacheRoot(FIXTURE, 4);
    expect(snap.transcriptsByDocId["doc-1"]).toBeDefined();
    expect(snap.transcriptsByDocId["doc-2"]).toBeUndefined();
  });

  it("throws when cache lacks a self user", () => {
    expect(() => parseCacheRoot({ cache: { documents: [] } }, 4)).toThrow(
      /missing self user/
    );
  });

  it("returns empty arrays for missing collections", () => {
    const snap = parseCacheRoot(
      {
        cache: {
          self: { id: "x", email: "y@z" },
          documents: [],
        },
      },
      4
    );
    expect(snap.documents).toEqual([]);
    expect(snap.documentLists).toEqual([]);
    expect(snap.people).toEqual([]);
  });

  it("handles string-encoded inner cache.value", () => {
    const wrapped = {
      cache: {
        value: JSON.stringify({
          self: { id: "x", email: "y@z" },
          documents: [{ id: "d1" }],
        }),
      },
    };
    const snap = parseCacheRoot(wrapped, 4);
    expect(snap.documents.length).toBe(1);
  });
});
