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
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
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
