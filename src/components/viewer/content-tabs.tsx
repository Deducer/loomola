"use client";

import { useEffect, useState, type ReactNode } from "react";

type TabKey = "transcript" | "comments";

export function ContentTabs({
  transcript,
  comments,
  commentCount = 0,
}: {
  transcript: ReactNode;
  comments: ReactNode;
  commentCount?: number;
}) {
  const [active, setActive] = useState<TabKey>("transcript");

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
    <div className="mt-8 sm:mt-12">
      <div role="tablist" className="flex gap-6 border-b border-border">
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              role="tab"
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
      <div className="mt-6">
        {active === "transcript" ? transcript : comments}
      </div>
    </div>
  );
}
