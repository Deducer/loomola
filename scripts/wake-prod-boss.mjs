#!/usr/bin/env node
// Wakes up production pg-boss by hitting an authed endpoint that calls
// `getBoss()` via `enqueueAiJobs`. After Coolify container restarts, boss
// is lazy-init — until something fires an enqueue, no worker polls. This
// script signs in with the test creator's bearer token and pokes
// POST /api/notes/<id>/enhance, which is the cheapest known boss-using
// endpoint that doesn't require an upload.
//
// Usage:
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     node scripts/wake-prod-boss.mjs <noteIdOrSlug>
//
// Pick a noteId/slug whose AI output you DON'T mind getting regenerated;
// the endpoint resets the existing ai_output for the note before enqueuing.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const noteId = process.argv[2];
if (!noteId) {
  console.error("usage: wake-prod-boss.mjs <noteIdOrSlug>");
  process.exit(1);
}

// Pull TEST_CREATOR_* from .env.local — Doppler doesn't have the test password
const env = await readFile(".env.local", "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const email = get("TEST_CREATOR_EMAIL");
const password = get("TEST_CREATOR_PASSWORD");
if (!email || !password) {
  throw new Error("TEST_CREATOR_EMAIL / TEST_CREATOR_PASSWORD missing in .env.local");
}

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const { data: signed, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (error) throw error;
const token = signed.session.access_token;
console.log(`[wake] signed in as ${email}`);

const url = `https://loom.dissonance.cloud/api/notes/${noteId}/enhance`;
console.log(`[wake] POST ${url}`);
const resp = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
console.log(`[wake] response: ${resp.status}`);
const text = await resp.text();
console.log(text.slice(0, 400));
