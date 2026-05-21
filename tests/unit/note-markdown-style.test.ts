import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("note markdown presentation", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/notes/note-page-client.tsx"),
    "utf8"
  );

  it("keeps enhanced note spacing readable on web", () => {
    expect(source).toContain("leading-[1.72]");
    expect(source).toContain("mb-5 mt-12");
    expect(source).toContain("space-y-3");
    expect(source).not.toContain("space-y-2.5");
  });

  it("distinguishes nested bullets on web", () => {
    expect(source).toContain("[&_ul]:list-[circle]");
    expect(source).toContain("[&_ul]:pl-8");
  });
});
