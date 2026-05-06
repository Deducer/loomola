import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunState } from "../src/state/run-state";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rstate-"));
  path = join(dir, "state.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("RunState", () => {
  it("returns null when no file exists", () => {
    expect(RunState.load(path)).toBeNull();
  });

  it("creates and reloads with empty buckets", () => {
    const s = RunState.create(path, {
      runId: "r1",
      loomolaServer: "https://example.com",
      granolaCacheVersion: 4,
      self: { granolaId: "g-self", loomolaUserId: "u-self" },
    });
    expect(s.data.granolaIds.succeeded).toEqual([]);
    s.markSucceeded("note-a");
    s.markFailed("note-b", "boom");
    s.markSkipped("note-c", "transcript-not-retrievable");
    const reloaded = RunState.load(path)!;
    expect(reloaded.data.granolaIds.succeeded).toEqual(["note-a"]);
    expect(reloaded.data.granolaIds.failed[0]?.error).toBe("boom");
    expect(reloaded.data.granolaIds.failed[0]?.attempts).toBe(1);
    expect(reloaded.data.granolaIds.skipped[0]?.reason).toBe(
      "transcript-not-retrievable"
    );
  });

  it("never leaves a .tmp file lingering", () => {
    const s = RunState.create(path, {
      runId: "r2",
      loomolaServer: "x",
      granolaCacheVersion: 4,
      self: { granolaId: "g", loomolaUserId: "u" },
    });
    s.markSucceeded("a");
    s.markSucceeded("b");
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("isSucceeded skips already-imported ids", () => {
    const s = RunState.create(path, {
      runId: "r3",
      loomolaServer: "x",
      granolaCacheVersion: 4,
      self: { granolaId: "g", loomolaUserId: "u" },
    });
    s.markSucceeded("note-1");
    expect(s.isSucceeded("note-1")).toBe(true);
    expect(s.isSucceeded("note-2")).toBe(false);
  });

  it("markSucceeded clears any matching failed entry", () => {
    const s = RunState.create(path, {
      runId: "r4",
      loomolaServer: "x",
      granolaCacheVersion: 4,
      self: { granolaId: "g", loomolaUserId: "u" },
    });
    s.markFailed("flaky", "first try");
    s.markFailed("flaky", "second try");
    expect(s.data.granolaIds.failed[0]?.attempts).toBe(2);
    s.markSucceeded("flaky");
    expect(s.data.granolaIds.succeeded).toContain("flaky");
    expect(s.data.granolaIds.failed.find((f) => f.id === "flaky")).toBeUndefined();
  });

  it("finish stamps finishedAt", () => {
    const s = RunState.create(path, {
      runId: "r5",
      loomolaServer: "x",
      granolaCacheVersion: 4,
      self: { granolaId: "g", loomolaUserId: "u" },
    });
    expect(s.data.finishedAt).toBeNull();
    s.finish();
    expect(s.data.finishedAt).not.toBeNull();
  });

  it("load returns null for malformed JSON", () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path, "not json", "utf8");
    expect(RunState.load(path)).toBeNull();
  });
});
