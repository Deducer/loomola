"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type TabKey = "transcript" | "comments";

export function ContentTabs({
  transcript,
  comments,
  commentCount = 0,
  panelOnXl = false,
}: {
  transcript: ReactNode;
  comments: ReactNode;
  commentCount?: number;
  /** At xl, render as a full-height side panel: tabs pinned at the top,
   *  the active tab's content scrolling underneath. Parent sets the height. */
  panelOnXl?: boolean;
}) {
  const [active, setActive] = useState<TabKey>("transcript");
  const idBase = useId();

  // Hydrate from URL ?tab=... on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("tab");
    if (fromUrl === "transcript" || fromUrl === "comments") {
      setActive(fromUrl);
    }
  }, []);

  function selectTab(next: TabKey) {
    setActive(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState({}, "", url.toString());
    }
  }

  const tabs: Array<{ key: TabKey; label: string; badge?: number }> = [
    { key: "transcript", label: "Transcript" },
    { key: "comments", label: "Comments", badge: commentCount },
  ];

  return (
    <div
      className={cn(
        "mt-8 sm:mt-12",
        panelOnXl &&
          "xl:mt-0 xl:flex xl:h-full xl:flex-col xl:overflow-hidden xl:rounded-xl xl:border xl:border-border xl:bg-bg-subtle/40"
      )}
    >
      <div
        role="tablist"
        aria-label="Transcript and comments"
        className={cn(
          "flex gap-6 border-b border-border",
          panelOnXl && "xl:shrink-0 xl:px-4"
        )}
      >
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              id={`${idBase}-tab-${t.key}`}
              aria-controls={`${idBase}-panel`}
              aria-selected={isActive}
              type="button"
              onClick={() => selectTab(t.key)}
              className={
                "relative -mb-px flex items-center gap-1.5 py-3 text-sm transition-colors " +
                (isActive ? "text-text" : "text-text-muted hover:text-text")
              }
            >
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors " +
                    (isActive
                      ? "bg-accent/15 text-accent"
                      : "bg-bg-elevated text-text-subtle")
                  }
                >
                  {t.badge}
                </span>
              )}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 h-px w-full"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${idBase}-panel`}
        aria-labelledby={`${idBase}-tab-${active}`}
        className={cn(
          "mt-6",
          panelOnXl && "xl:mt-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:p-2",
          // Comments scroll here; the transcript scrolls its own list so
          // auto-follow can move it without touching the page.
          panelOnXl && active === "comments" && "xl:p-4"
        )}
      >
        {active === "transcript" ? transcript : comments}
      </div>
    </div>
  );
}
