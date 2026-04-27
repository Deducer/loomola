"use client";

import type { ReactNode } from "react";

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
          {settings}
          {trim}
          {downloads}
          {analytics}
          {danger}
        </div>
      </div>
    </div>
  );
}
