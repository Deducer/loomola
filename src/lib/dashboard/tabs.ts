export type DashboardTab = "recordings" | "notes";

export function getDashboardTab(
  value: string | undefined,
  granolaEnabled: boolean
): DashboardTab {
  return granolaEnabled && value === "notes" ? "notes" : "recordings";
}

export function dashboardTabHref(
  currentParams: URLSearchParams,
  tab: DashboardTab
): string {
  const next = new URLSearchParams(currentParams);
  if (tab === "notes") {
    next.set("tab", "notes");
    next.delete("sort");
    next.delete("status");
    next.delete("brand");
  } else {
    next.delete("tab");
  }
  const qs = next.toString();
  return qs ? `/?${qs}` : "/";
}
