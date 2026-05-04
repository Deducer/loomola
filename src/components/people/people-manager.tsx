"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Person } from "@/db/queries/people";

type Draft = {
  displayName: string;
  email: string;
  notes: string;
};

const EMPTY_DRAFT: Draft = { displayName: "", email: "", notes: "" };

export function PeopleManager({
  initialPeople,
  hasSelf = true,
  authEmail = null,
}: {
  initialPeople: Person[];
  hasSelf?: boolean;
  authEmail?: string | null;
}) {
  const [people, setPeople] = useState(initialPeople);
  const [selfMissing, setSelfMissing] = useState(!hasSelf);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  async function createSelfPerson() {
    setBusy(true);
    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: deriveSelfName(authEmail),
          email: authEmail,
          isSelf: true,
        }),
      });
      if (!response.ok) throw new Error("create_self_failed");
      const person = (await response.json()) as Person;
      setPeople((current) => [person, ...current]);
      setSelfMissing(false);
    } finally {
      setBusy(false);
    }
  }

  async function createPerson() {
    const displayName = draft.displayName.trim();
    if (!displayName) return;
    setBusy(true);
    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          email: draft.email.trim() || null,
          notes: draft.notes.trim() || null,
        }),
      });
      if (!response.ok) throw new Error("create_failed");
      const person = (await response.json()) as Person;
      setPeople((current) => [person, ...current]);
      setDraft(EMPTY_DRAFT);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const displayName = editingDraft.displayName.trim();
    if (!displayName) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/people/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          email: editingDraft.email.trim() || null,
          notes: editingDraft.notes.trim() || null,
        }),
      });
      if (!response.ok) throw new Error("update_failed");
      const person = (await response.json()) as Person;
      setPeople((current) =>
        current.map((item) => (item.id === person.id ? person : item))
      );
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  }

  async function deletePerson(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/people/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete_failed");
      setPeople((current) => current.filter((item) => item.id !== id));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(person: Person) {
    setEditingId(person.id);
    setEditingDraft({
      displayName: person.displayName,
      email: person.email ?? "",
      notes: person.notes ?? "",
    });
  }

  return (
    <div className="space-y-6">
      {selfMissing && (
        <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/5 p-4">
          <User className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">
              Mark yourself in your contacts
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Adds a "you" record so future recordings can identify your
              voice as the host and auto-label the other speakers.
            </p>
          </div>
          <Button size="sm" onClick={createSelfPerson} disabled={busy}>
            <Plus className="h-4 w-4" />
            Add me
          </Button>
        </div>
      )}

      <section className="rounded-lg border border-border bg-bg-subtle p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Input
            value={draft.displayName}
            onChange={(event) =>
              setDraft((current) => ({ ...current, displayName: event.target.value }))
            }
            placeholder="Name"
          />
          <Input
            value={draft.email}
            onChange={(event) =>
              setDraft((current) => ({ ...current, email: event.target.value }))
            }
            placeholder="Email"
            type="email"
          />
          <Button onClick={createPerson} disabled={busy || !draft.displayName.trim()}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        <Textarea
          value={draft.notes}
          onChange={(event) =>
            setDraft((current) => ({ ...current, notes: event.target.value }))
          }
          placeholder="Notes"
          className="mt-3 min-h-20"
        />
      </section>

      <div className="divide-y divide-border rounded-lg border border-border bg-bg-subtle">
        {people.length === 0 ? (
          <p className="p-6 text-sm text-text-muted">No people yet.</p>
        ) : (
          people.map((person) => (
            <div key={person.id} className="p-4">
              {editingId === person.id ? (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      value={editingDraft.displayName}
                      onChange={(event) =>
                        setEditingDraft((current) => ({
                          ...current,
                          displayName: event.target.value,
                        }))
                      }
                    />
                    <Input
                      value={editingDraft.email}
                      onChange={(event) =>
                        setEditingDraft((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      type="email"
                    />
                  </div>
                  <Textarea
                    value={editingDraft.notes}
                    onChange={(event) =>
                      setEditingDraft((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    className="min-h-20"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveEdit(person.id)}
                      disabled={busy || !editingDraft.displayName.trim()}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-text">{person.displayName}</p>
                    {person.email && (
                      <p className="mt-1 text-sm text-text-muted">{person.email}</p>
                    )}
                    {person.notes && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-text-subtle">
                        {person.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => startEdit(person)}
                      aria-label="Edit person"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deletePerson(person.id)}
                      aria-label="Delete person"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {editingId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditingId(null)}
          className="fixed bottom-4 right-4 md:hidden"
        >
          <X className="h-4 w-4" />
          Close edit
        </Button>
      )}
    </div>
  );
}

/** Best-effort default name from the user's auth email. The user can edit
 *  on creation; this just spares them typing. */
function deriveSelfName(authEmail: string | null): string {
  if (!authEmail) return "Me";
  const local = authEmail.split("@")[0] ?? "";
  if (!local) return "Me";
  // Convert "ian.cross" or "iancross" or "ian-cross" to a title-cased name.
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Me";
}
