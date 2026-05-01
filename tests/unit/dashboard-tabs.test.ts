import { describe, expect, it } from "vitest";
import { dashboardTabHref, getDashboardTab } from "@/lib/dashboard/tabs";

describe("dashboard tabs", () => {
  it("keeps recordings as the default tab", () => {
    expect(getDashboardTab(undefined, true)).toBe("recordings");
    expect(getDashboardTab("notes", false)).toBe("recordings");
  });

  it("enables notes only when Granola is enabled", () => {
    expect(getDashboardTab("notes", true)).toBe("notes");
  });

  it("drops recording-only filters when linking to notes", () => {
    const params = new URLSearchParams({
      q: "test",
      folder: "abc",
      sort: "views_desc",
      status: "ready",
      brand: "brand-1",
    });

    expect(dashboardTabHref(params, "notes")).toBe("/?q=test&folder=abc&tab=notes");
  });

  it("uses the clean root URL for recordings", () => {
    expect(dashboardTabHref(new URLSearchParams({ tab: "notes" }), "recordings")).toBe(
      "/"
    );
  });
});
