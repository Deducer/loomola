"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DictionaryTerm } from "@/db/queries/dictionary-terms";

export function DictionaryManager({
  initialTerms,
}: {
  initialTerms: DictionaryTerm[];
}) {
  const [terms, setTerms] = useState(initialTerms);
  const [term, setTerm] = useState("");
  const [variantOf, setVariantOf] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [busy, setBusy] = useState(false);

  const canonicalTerms = useMemo(
    () => terms.filter((item) => item.variantOf === null),
    [terms]
  );
  const canonicalById = useMemo(
    () => new Map(canonicalTerms.map((item) => [item.id, item])),
    [canonicalTerms]
  );

  async function createTerm(nextTerm: string, nextVariantOf: string | null) {
    const response = await fetch("/api/dictionary-terms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: nextTerm, variantOf: nextVariantOf }),
    });
    if (!response.ok) throw new Error("dictionary_term_create_failed");
    return (await response.json()) as DictionaryTerm;
  }

  async function addTerm() {
    const trimmed = term.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const row = await createTerm(trimmed, variantOf || null);
      setTerms((current) => [...current, row].sort(sortTerms));
      setTerm("");
      setVariantOf("");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTerm(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/dictionary-terms/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("dictionary_term_delete_failed");
      setTerms((current) => current.filter((item) => item.id !== id));
    } finally {
      setBusy(false);
    }
  }

  async function bulkImport() {
    const lines = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setBusy(true);
    try {
      const nextTerms = [...terms];
      const canonicalByLower = new Map(
        nextTerms
          .filter((item) => item.variantOf === null)
          .map((item) => [item.term.toLowerCase(), item])
      );

      for (const line of lines) {
        const [rawTerm, rawCanonical] = line.split(",").map((part) => part.trim());
        if (!rawTerm) continue;

        if (!rawCanonical) {
          if (nextTerms.some((item) => item.term.toLowerCase() === rawTerm.toLowerCase())) {
            continue;
          }
          const created = await createTerm(rawTerm, null);
          nextTerms.push(created);
          canonicalByLower.set(created.term.toLowerCase(), created);
          continue;
        }

        let canonical = canonicalByLower.get(rawCanonical.toLowerCase());
        if (!canonical) {
          canonical = await createTerm(rawCanonical, null);
          nextTerms.push(canonical);
          canonicalByLower.set(canonical.term.toLowerCase(), canonical);
        }

        if (nextTerms.some((item) => item.term.toLowerCase() === rawTerm.toLowerCase())) {
          continue;
        }
        const variant = await createTerm(rawTerm, canonical.id);
        nextTerms.push(variant);
      }

      setTerms(nextTerms.sort(sortTerms));
      setBulkText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-bg-subtle p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Term"
          />
          <Select
            value={variantOf}
            onChange={(event) => setVariantOf(event.target.value)}
          >
            <option value="">Canonical term</option>
            {canonicalTerms.map((item) => (
              <option key={item.id} value={item.id}>
                Variant of {item.term}
              </option>
            ))}
          </Select>
          <Button onClick={addTerm} disabled={busy || !term.trim()}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-subtle p-4">
        <Textarea
          value={bulkText}
          onChange={(event) => setBulkText(event.target.value)}
          placeholder={"One term per line\nAmaan, Aman"}
          className="min-h-32"
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={bulkImport} disabled={busy || !bulkText.trim()}>
            <Upload className="h-4 w-4" />
            Import
          </Button>
        </div>
      </section>

      <div className="divide-y divide-border rounded-lg border border-border bg-bg-subtle">
        {terms.length === 0 ? (
          <p className="p-6 text-sm text-text-muted">No dictionary terms yet.</p>
        ) : (
          terms.map((item) => {
            const canonical = item.variantOf
              ? canonicalById.get(item.variantOf)?.term ?? "Missing canonical"
              : null;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{item.term}</p>
                  <p className="mt-1 text-xs text-text-subtle">
                    {canonical ? `Variant of ${canonical}` : "Canonical"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteTerm(item.id)}
                  disabled={busy}
                  aria-label="Delete dictionary term"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function sortTerms(a: DictionaryTerm, b: DictionaryTerm) {
  return a.term.localeCompare(b.term);
}
