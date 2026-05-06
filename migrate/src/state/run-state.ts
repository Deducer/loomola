// Atomic-write run state for the loomola-migrate CLI.
//
// State lives at ~/.loomola-migrate/state.json. Updated after each
// note's outcome (write-tmp + rename) so a crash mid-run leaves a
// consistent file on disk. Re-runs read this to skip already-imported
// ids without re-shaping payloads.
//
// Spec: docs/superpowers/specs/2026-05-06-granola-migration-tool-design.md

import {
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";

export type RunStateFile = {
  version: 1;
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  loomolaServer: string;
  granolaCacheVersion: number;
  self: { granolaId: string; loomolaUserId: string };
  granolaIds: {
    succeeded: string[];
    failed: Array<{
      id: string;
      error: string;
      attempts: number;
      lastAttemptAt: string;
    }>;
    skipped: Array<{ id: string; reason: string }>;
  };
};

export class RunState {
  constructor(
    public readonly path: string,
    public data: RunStateFile
  ) {}

  static load(path: string): RunState | null {
    if (!existsSync(path)) return null;
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as RunStateFile;
      return new RunState(path, data);
    } catch {
      return null;
    }
  }

  static create(
    path: string,
    init: Pick<
      RunStateFile,
      "runId" | "loomolaServer" | "granolaCacheVersion" | "self"
    >
  ): RunState {
    const data: RunStateFile = {
      version: 1,
      runId: init.runId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      loomolaServer: init.loomolaServer,
      granolaCacheVersion: init.granolaCacheVersion,
      self: init.self,
      granolaIds: { succeeded: [], failed: [], skipped: [] },
    };
    const s = new RunState(path, data);
    s.persist();
    return s;
  }

  isSucceeded(id: string): boolean {
    return this.data.granolaIds.succeeded.includes(id);
  }

  markSucceeded(id: string): void {
    if (!this.data.granolaIds.succeeded.includes(id)) {
      this.data.granolaIds.succeeded.push(id);
    }
    this.data.granolaIds.failed = this.data.granolaIds.failed.filter(
      (f) => f.id !== id
    );
    this.persist();
  }

  markFailed(id: string, error: string): void {
    const existing = this.data.granolaIds.failed.find((f) => f.id === id);
    if (existing) {
      existing.attempts += 1;
      existing.error = error;
      existing.lastAttemptAt = new Date().toISOString();
    } else {
      this.data.granolaIds.failed.push({
        id,
        error,
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
      });
    }
    this.persist();
  }

  markSkipped(id: string, reason: string): void {
    if (!this.data.granolaIds.skipped.find((s) => s.id === id)) {
      this.data.granolaIds.skipped.push({ id, reason });
    }
    this.persist();
  }

  finish(): void {
    this.data.finishedAt = new Date().toISOString();
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.path);
  }
}
