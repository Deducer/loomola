"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { Folder as DbFolder } from "@/db/queries/folders";

type Node = DbFolder & { children: Node[]; depth: number };

/**
 * Mobile-only folder picker — the FolderSidebar is hidden below md
 * because at 240 px wide it leaves no room for the recordings grid
 * on a phone. Render a flat <select> above the search bar so
 * navigating folders is still reachable on touch.
 */
export function MobileFolderPicker({
  folders,
  currentFolderId,
}: {
  folders: DbFolder[];
  currentFolderId: string | null | undefined;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const flat = useMemo(() => flattenTree(folders), [folders]);

  const value =
    currentFolderId === undefined
      ? ""
      : currentFolderId === null
        ? "__unfiled"
        : currentFolderId;

  function navigate(next: string) {
    const np = new URLSearchParams(params.toString());
    if (!next) np.delete("folder");
    else np.set("folder", next);
    router.push("/?" + np.toString());
  }

  return (
    <div className="md:hidden">
      <label
        htmlFor="mobile-folder"
        className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
      >
        Folder
      </label>
      <select
        id="mobile-folder"
        value={value}
        onChange={(e) => navigate(e.target.value)}
        className="mt-1.5 block w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-text"
      >
        <option value="">All recordings</option>
        <option value="__unfiled">Unfiled</option>
        {flat.map((f) => (
          <option key={f.id} value={f.id}>
            {"  ".repeat(f.depth)}
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function flattenTree(folders: DbFolder[]): Node[] {
  const byId = new Map<string, Node>();
  for (const f of folders) byId.set(f.id, { ...f, children: [], depth: 0 });
  const roots: Node[] = [];
  for (const f of folders) {
    const node = byId.get(f.id)!;
    if (f.parentId && byId.has(f.parentId)) {
      byId.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortChildren = (nodes: Node[], depth: number) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) {
      n.depth = depth;
      sortChildren(n.children, depth + 1);
    }
  };
  sortChildren(roots, 0);
  const out: Node[] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}
