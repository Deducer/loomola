"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Inbox,
  Layers,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { Folder as DbFolder } from "@/db/queries/folders";

type Node = DbFolder & { children: Node[] };

function buildTree(folders: DbFolder[]): Node[] {
  const byId = new Map<string, Node>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  const roots: Node[] = [];
  for (const f of folders) {
    const node = byId.get(f.id)!;
    if (f.parentId && byId.has(f.parentId)) {
      byId.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

function goto(
  router: ReturnType<typeof useRouter>,
  params: URLSearchParams,
  patch: Record<string, string | null>
) {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  router.push("/?" + next.toString());
}

export function FolderSidebar({
  folders,
  currentFolderId,
  allLabel = "All recordings",
}: {
  folders: DbFolder[];
  currentFolderId: string | null | undefined;
  allLabel?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const tree = useMemo(() => buildTree(folders), [folders]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creatingParentId, setCreatingParentId] = useState<
    string | null | undefined
  >(undefined);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onDropToAll(e: React.DragEvent) {
    e.preventDefault();
    const recordingId = e.dataTransfer.getData("application/x-recording-id");
    if (!recordingId) return;
    await fetch(`/api/recordings/${recordingId}/folder`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId: null }),
    });
    router.refresh();
  }

  const p = new URLSearchParams(params.toString());

  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-1 border-r border-border px-3 py-4 text-sm md:flex">
      <SidebarLink
        icon={<Layers className="h-4 w-4" />}
        label={allLabel}
        active={currentFolderId === undefined}
        onClick={() => goto(router, p, { folder: null })}
      />
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          currentFolderId === null
            ? "bg-bg-elevated text-text"
            : "text-text-muted hover:bg-bg-subtle hover:text-text"
        )}
        onClick={() => goto(router, p, { folder: "__unfiled" })}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={onDropToAll}
      >
        <Inbox className="h-4 w-4" />
        <span className="truncate">Unfiled</span>
      </button>

      <div className="mt-4 flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
        Folders
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => setCreatingParentId(null)}
          aria-label="New folder at root"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-1">
        {creatingParentId === null && (
          <NewFolderRow
            depth={0}
            parentId={null}
            onDone={() => setCreatingParentId(undefined)}
          />
        )}
        {tree.map((node) => (
          <FolderNodeRow
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            toggleExpand={toggleExpand}
            currentFolderId={currentFolderId}
            creatingParentId={creatingParentId}
            setCreatingParentId={setCreatingParentId}
          />
        ))}
      </div>

      <Link
        href="/trash"
        className="mt-4 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-text-subtle transition-colors hover:bg-bg-subtle hover:text-text-muted"
      >
        <Trash2 className="h-4 w-4" />
        <span className="truncate">Trash</span>
      </Link>
    </aside>
  );
}

function SidebarLink({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        active
          ? "bg-bg-elevated text-text"
          : "text-text-muted hover:bg-bg-subtle hover:text-text"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function FolderNodeRow({
  node,
  depth,
  expanded,
  toggleExpand,
  currentFolderId,
  creatingParentId,
  setCreatingParentId,
}: {
  node: Node;
  depth: number;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  currentFolderId: string | null | undefined;
  creatingParentId: string | null | undefined;
  setCreatingParentId: (v: string | null | undefined) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const active = currentFolderId === node.id;
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const p = new URLSearchParams(params.toString());

  async function onDropRecording(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const recordingId = e.dataTransfer.getData("application/x-recording-id");
    if (!recordingId) return;
    await fetch(`/api/recordings/${recordingId}/folder`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId: node.id }),
    });
    router.refresh();
  }

  // Two-tap confirm (same pattern as the bulk-select bar); disarms after 3s.
  async function deleteMe() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    setConfirmingDelete(false);
    await fetch(`/api/folders/${node.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1 py-1 text-sm transition-colors",
          active
            ? "bg-bg-elevated text-text"
            : "text-text-muted hover:bg-bg-subtle hover:text-text"
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={onDropRecording}
      >
        <button
          type="button"
          onClick={() => hasChildren && toggleExpand(node.id)}
          className={cn(
            "flex h-5 w-5 items-center justify-center transition-transform",
            hasChildren ? "opacity-100" : "opacity-0",
            isOpen && "rotate-90"
          )}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <Folder className="h-4 w-4 shrink-0" />
        {renaming ? (
          <RenameInput
            folderId={node.id}
            initial={node.name}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => goto(router, p, { folder: node.id })}
            className="flex-1 truncate text-left"
          >
            {node.name}
          </button>
        )}
        <div className="hidden items-center gap-0.5 group-hover:flex">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setCreatingParentId(node.id)}
            aria-label="New subfolder"
          >
            <FolderPlus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setRenaming(true)}
            aria-label="Rename folder"
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-5 w-5", confirmingDelete && "bg-destructive/15")}
            onClick={deleteMe}
            aria-label={
              confirmingDelete
                ? "Confirm delete folder (subfolders deleted; recordings become unfiled)"
                : "Delete folder"
            }
            title={
              confirmingDelete
                ? "Click again to delete — subfolders are deleted too; recordings become unfiled"
                : "Delete folder"
            }
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      </div>
      {creatingParentId === node.id && (
        <NewFolderRow
          depth={depth + 1}
          parentId={node.id}
          onDone={() => setCreatingParentId(undefined)}
        />
      )}
      {isOpen &&
        node.children.map((c) => (
          <FolderNodeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            toggleExpand={toggleExpand}
            currentFolderId={currentFolderId}
            creatingParentId={creatingParentId}
            setCreatingParentId={setCreatingParentId}
          />
        ))}
    </>
  );
}

function NewFolderRow({
  depth,
  parentId,
  onDone,
}: {
  depth: number;
  parentId: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      onDone();
      return;
    }
    await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed, parentId }),
    });
    onDone();
    router.refresh();
  }
  return (
    <div style={{ paddingLeft: 20 + depth * 12 }} className="py-1 pr-2">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onDone();
        }}
        onBlur={save}
        placeholder="New folder"
        className="h-7 text-xs"
      />
    </div>
  );
}

function RenameInput({
  folderId,
  initial,
  onDone,
}: {
  folderId: string;
  initial: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initial) {
      onDone();
      return;
    }
    await fetch(`/api/folders/${folderId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    onDone();
    router.refresh();
  }
  return (
    <Input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") onDone();
      }}
      onBlur={save}
      className="h-6 flex-1 text-xs"
    />
  );
}
