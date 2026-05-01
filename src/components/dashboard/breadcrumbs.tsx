"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Folder } from "@/db/queries/folders";

export function Breadcrumbs({
  folders,
  currentId,
  rootLabel = "All recordings",
  tab = "recordings",
}: {
  folders: Folder[];
  currentId: string;
  rootLabel?: string;
  tab?: "recordings" | "notes";
}) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: Folder[] = [];
  let cursor: Folder | undefined = byId.get(currentId);
  while (cursor) {
    chain.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  if (chain.length === 0) return null;
  const tabParam = tab === "notes" ? "?tab=notes" : "";
  const folderHref = (folderId: string) =>
    tab === "notes" ? `/?tab=notes&folder=${folderId}` : `/?folder=${folderId}`;

  return (
    <nav className="flex items-center gap-1 text-sm text-text-muted">
      <Link href={`/${tabParam}`} className="hover:text-text">
        {rootLabel}
      </Link>
      {chain.map((f, i) => (
        <span key={f.id} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-text-subtle" />
          {i === chain.length - 1 ? (
            <span className="text-text">{f.name}</span>
          ) : (
            <Link href={folderHref(f.id)} className="hover:text-text">
              {f.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
