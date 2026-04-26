"use client";

import { useEffect, useState, type ReactNode } from "react";

type TabKey = "transcript" | "comments";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "transcript", label: "Transcript" },
  { key: "comments", label: "Comments" },
];

export function ContentTabs({
  transcript,
  comments,
}: {
  transcript: ReactNode;
  comments: ReactNode;
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

  return (
    <div className="mt-12">
      <div role="tablist" className="flex gap-6 border-b border-border">
        {TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => selectTab(t.key)}
              className={
                "relative -mb-px py-3 text-sm transition-colors " +
                (isActive
                  ? "text-text"
                  : "text-text-muted hover:text-text")
              }
            >
              {t.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 h-px w-full bg-text" />
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
