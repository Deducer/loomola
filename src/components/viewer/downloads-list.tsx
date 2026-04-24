"use client";

import { Download } from "lucide-react";

export type DownloadLink = { kind: string; href: string };

export function DownloadsList({ links }: { links: DownloadLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm">
      <div className="flex items-center gap-2 text-text-muted">
        <Download className="h-4 w-4 text-text-subtle" />
        <span>Downloads</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.kind}>
            <a
              href={l.href}
              download
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {l.kind}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
