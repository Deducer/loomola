"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { BrandProfile } from "@/db/queries/brand-profiles";

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "ready", label: "Ready" },
  { value: "processing", label: "Processing" },
  { value: "transcribing", label: "Transcribing" },
  { value: "uploading", label: "Uploading" },
  { value: "failed", label: "Failed" },
];

const SORTS = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "duration_desc", label: "Longest first" },
  { value: "duration_asc", label: "Shortest first" },
  { value: "views_desc", label: "Most viewed" },
  { value: "title_asc", label: "Title A-Z" },
];

export function SearchFilterBar({ brands }: { brands: BrandProfile[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      router.push("/?" + next.toString());
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function patchParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    router.push("/?" + next.toString());
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search titles + transcripts…"
          className="pl-9"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border-strong bg-bg-elevated px-1.5 font-mono text-[10px] text-text-subtle sm:inline-flex">
          ⌘K
        </kbd>
      </div>
      <Select
        className="sm:w-44"
        value={params.get("sort") ?? "date_desc"}
        onChange={(e) => patchParam("sort", e.target.value)}
      >
        {SORTS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Select
        className="sm:w-40"
        value={params.get("status") ?? ""}
        onChange={(e) => patchParam("status", e.target.value)}
      >
        {STATUSES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {brands.length > 0 && (
        <Select
          className="sm:w-44"
          value={params.get("brand") ?? ""}
          onChange={(e) => patchParam("brand", e.target.value)}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
