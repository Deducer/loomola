import { afterEach, describe, expect, it } from "vitest";
import { trashRetentionDays } from "@/lib/queue/jobs/purge-deleted";
import { deleteObjectsByPrefix } from "@/lib/r2/delete-objects";

afterEach(() => {
  delete process.env.TRASH_RETENTION_DAYS;
});

describe("trashRetentionDays", () => {
  it("defaults to 30", () => {
    expect(trashRetentionDays()).toBe(30);
  });

  it("honors TRASH_RETENTION_DAYS", () => {
    process.env.TRASH_RETENTION_DAYS = "7";
    expect(trashRetentionDays()).toBe(7);
  });

  it("falls back to 30 on garbage / non-positive values", () => {
    process.env.TRASH_RETENTION_DAYS = "soon";
    expect(trashRetentionDays()).toBe(30);
    process.env.TRASH_RETENTION_DAYS = "0";
    expect(trashRetentionDays()).toBe(30);
    process.env.TRASH_RETENTION_DAYS = "-5";
    expect(trashRetentionDays()).toBe(30);
  });
});

describe("deleteObjectsByPrefix", () => {
  it("refuses prefixes that could enumerate the whole bucket", async () => {
    // Guard runs before any client/credential setup, so no mocking needed.
    await expect(deleteObjectsByPrefix("")).rejects.toThrow(/unsafe prefix/);
    await expect(deleteObjectsByPrefix("/")).rejects.toThrow(/unsafe prefix/);
    await expect(deleteObjectsByPrefix("slug-no-slash")).rejects.toThrow(
      /unsafe prefix/
    );
  });
});
