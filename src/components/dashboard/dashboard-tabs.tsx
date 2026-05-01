import Link from "next/link";
import { FileText, Video } from "lucide-react";
import { cn } from "@/lib/cn";
import { dashboardTabHref, type DashboardTab } from "@/lib/dashboard/tabs";

export function DashboardTabs({
  activeTab,
  params,
}: {
  activeTab: DashboardTab;
  params: URLSearchParams;
}) {
  const tabs = [
    { key: "recordings" as const, label: "Recordings", icon: Video },
    { key: "notes" as const, label: "Notes", icon: FileText },
  ];

  return (
    <div className="inline-flex rounded-lg border border-border bg-bg-subtle p-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.key;
        return (
          <Link
            key={tab.key}
            href={dashboardTabHref(params, tab.key)}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm transition-colors",
              active
                ? "bg-bg-elevated text-text shadow-sm"
                : "text-text-muted hover:text-text"
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
