import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-next";

describe("safeNextPath", () => {
  it("returns '/' for null", () => {
    expect(safeNextPath(null)).toBe("/");
  });

  it("passes through a valid same-origin path", () => {
    expect(safeNextPath("/auth/reset")).toBe("/auth/reset");
  });

  it("blocks //evil.com (protocol-relative open redirect)", () => {
    expect(safeNextPath("//evil.com")).toBe("/");
  });

  it("blocks /\\evil.com (backslash open redirect trick)", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/");
  });

  it("blocks https://evil.com (absolute URL)", () => {
    expect(safeNextPath("https://evil.com")).toBe("/");
  });

  it("blocks @evil.com (userinfo trick)", () => {
    expect(safeNextPath("@evil.com")).toBe("/");
  });
});
