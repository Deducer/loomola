"use client";

import { Fragment, type ReactNode } from "react";

export function EditShell({
  preview,
  header,
  settings,
  trim,
  downloads,
  analytics,
  danger,
}: {
  preview: ReactNode;
  header: ReactNode;
  settings: ReactNode;
  trim: ReactNode;
  downloads: ReactNode;
  analytics: ReactNode;
  danger: ReactNode;
}) {
  // Keyed slot list — `downloads` and `analytics` are conditionally
  // null, which makes React 19's positional key inference ambiguous
  // and warn under StrictMode. Stable keys per slot make the
  // reconciler happy without changing rendered DOM.
  const slots: Array<{ key: string; node: ReactNode }> = [
    { key: "settings", node: settings },
    { key: "trim", node: trim },
    { key: "downloads", node: downloads },
    { key: "analytics", node: analytics },
    { key: "danger", node: danger },
  ];

  return (
    <div>
      <div className="mb-8">{header}</div>
      {/* Two-column with settings capped at 360px so the video preview
          gets the lion's share of the page, and settings stay visually
          tight (no sprawled, half-empty cards on wide screens). */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          {preview}
        </aside>
        <div className="space-y-10">
          {slots.map(({ key, node }) => (
            <Fragment key={key}>{node}</Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
