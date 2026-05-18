"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Plus, Trash2, Upload } from "lucide-react";
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
  const variantsByCanonicalId = useMemo(() => {
    const grouped = new Map<string, DictionaryTerm[]>();
    for (const item of terms) {
      if (!item.variantOf) continue;
      const list = grouped.get(item.variantOf) ?? [];
      list.push(item);
      grouped.set(item.variantOf, list);
    }
    for (const list of grouped.values()) list.sort(sortTerms);
    return grouped;
  }, [terms]);
  const orphanVariants = useMemo(
    () =>
      terms.filter(
        (item) => item.variantOf !== null && !canonicalById.has(item.variantOf)
      ),
    [canonicalById, terms]
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
        <div className="mb-4 grid gap-3 text-sm text-text-muted md:grid-cols-2">
          <div className="rounded-md border border-border bg-bg px-3 py-2">
            <p className="font-medium text-text">Correct spelling</p>
            <p className="mt-1 text-xs leading-5">
              The word or phrase Loomola should prefer and send as a transcription hint.
            </p>
          </div>
          <div className="rounded-md border border-border bg-bg px-3 py-2">
            <p className="font-medium text-text">Misheard as</p>
            <p className="mt-1 text-xs leading-5">
              A transcript mistake that should be rewritten to the correct spelling.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_260px_auto]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-subtle">
              {variantOf ? "Misheard spelling" : "Correct spelling"}
            </span>
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={variantOf ? "Sanada" : "Sunyata"}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-subtle">
              Use as
            </span>
            <Select
              value={variantOf}
              onChange={(event) => setVariantOf(event.target.value)}
            >
              <option value="">Correct spelling / keyword hint</option>
              {canonicalTerms.map((item) => (
                <option key={item.id} value={item.id}>
                  Rewrite to {item.term}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex items-end">
            <Button onClick={addTerm} disabled={busy || !term.trim()}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-subtle p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-text">Bulk add</h2>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            One correct spelling per line, or a misheard spelling followed by the correction.
          </p>
        </div>
        <Textarea
          value={bulkText}
          onChange={(event) => setBulkText(event.target.value)}
          placeholder={"Sunyata\nSanada, Sunyata\nValue Labs, Vayu Labs"}
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
          <div className="p-6 text-sm text-text-muted">
            Add names, companies, projects, and unusual phrases before the next meeting.
          </div>
        ) : (
          <>
            {canonicalTerms.map((item) => (
              <DictionaryGroup
                key={item.id}
                canonical={item}
                variants={variantsByCanonicalId.get(item.id) ?? []}
                busy={busy}
                onDelete={deleteTerm}
              />
            ))}
            {orphanVariants.map((item) => (
              <DictionaryRow
                key={item.id}
                term={item.term}
                label="Missing correction"
                busy={busy}
                onDelete={() => deleteTerm(item.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function DictionaryGroup({
  canonical,
  variants,
  busy,
  onDelete,
}: {
  canonical: DictionaryTerm;
  variants: DictionaryTerm[];
  busy: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <p className="truncate text-sm font-medium text-text">{canonical.term}</p>
          </div>
          <p className="mt-1 text-xs text-text-subtle">
            Correct spelling and transcription keyword
          </p>
        </div>
        <DeleteTermButton
          disabled={busy}
          onClick={() => onDelete(canonical.id)}
          label={`Delete ${canonical.term}`}
        />
      </div>
      {variants.length > 0 && (
        <div className="mt-3 space-y-2 pl-6">
          {variants.map((variant) => (
            <div
              key={variant.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm text-text-muted">{variant.term}</p>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
                <p className="truncate text-sm font-medium text-text">
                  {canonical.term}
                </p>
              </div>
              <DeleteTermButton
                disabled={busy}
                onClick={() => onDelete(variant.id)}
                label={`Delete ${variant.term}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DictionaryRow({
  term,
  label,
  busy,
  onDelete,
}: {
  term: string;
  label: string;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-text">{term}</p>
        <p className="mt-1 text-xs text-red-400">{label}</p>
      </div>
      <DeleteTermButton disabled={busy} onClick={onDelete} label={`Delete ${term}`} />
    </div>
  );
}

function DeleteTermButton({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

function sortTerms(a: DictionaryTerm, b: DictionaryTerm) {
  return a.term.localeCompare(b.term);
}
