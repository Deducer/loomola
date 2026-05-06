// Granola WorkOS auth — reads tokens from the desktop app's local
// `supabase.json`, refreshes via Granola's token-refresh endpoint.
//
// The CLI never writes back to supabase.json. The Granola desktop app
// owns that file; we only need an in-memory copy of the access token
// for our own session.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GranolaTokens } from "./types";

const SUPABASE_JSON_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Granola",
  "supabase.json"
);

export class GranolaAuth {
  private constructor(private tokens: GranolaTokens) {}

  static load(): GranolaAuth {
    let raw: string;
    try {
      raw = readFileSync(SUPABASE_JSON_PATH, "utf8");
    } catch {
      throw new Error(
        `Granola tokens not found at ${SUPABASE_JSON_PATH}. ` +
          `Sign in to Granola.app once, then re-run.`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Granola tokens malformed in ${SUPABASE_JSON_PATH}. ` +
          `Open Granola.app to refresh.`
      );
    }
    // workos_tokens is stored as a JSON-encoded STRING in supabase.json,
    // not as a nested object. Parse it.
    let workosTokens: { access_token?: unknown; refresh_token?: unknown };
    const rawTokens = (parsed as { workos_tokens?: unknown })?.workos_tokens;
    if (typeof rawTokens === "string") {
      try {
        workosTokens = JSON.parse(rawTokens);
      } catch {
        throw new Error(
          `Granola workos_tokens malformed in ${SUPABASE_JSON_PATH}. ` +
            `Open Granola.app to refresh.`
        );
      }
    } else if (rawTokens && typeof rawTokens === "object") {
      // Older Granola versions stored it as an object directly.
      workosTokens = rawTokens as typeof workosTokens;
    } else {
      throw new Error(
        `Granola workos_tokens missing in ${SUPABASE_JSON_PATH}. ` +
          `Open Granola.app and sign in.`
      );
    }
    const access = workosTokens.access_token;
    const refresh = workosTokens.refresh_token;
    if (typeof access !== "string" || typeof refresh !== "string") {
      throw new Error(
        `Granola tokens missing in ${SUPABASE_JSON_PATH}. ` +
          `Open Granola.app and sign in.`
      );
    }
    return new GranolaAuth({
      accessToken: access,
      refreshToken: refresh,
      expiresAt: null,
    });
  }

  static fromTokens(tokens: GranolaTokens): GranolaAuth {
    return new GranolaAuth(tokens);
  }

  get accessToken(): string {
    return this.tokens.accessToken;
  }

  async refresh(): Promise<void> {
    const res = await fetch("https://api.granola.ai/v1/refresh-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: this.tokens.refreshToken }),
    });
    if (!res.ok) {
      throw new Error(
        `Granola token refresh failed (${res.status}). ` +
          `Open Granola.app and sign in again.`
      );
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!data.access_token) {
      throw new Error("Granola refresh response missing access_token.");
    }
    this.tokens.accessToken = data.access_token;
    if (data.refresh_token) this.tokens.refreshToken = data.refresh_token;
  }
}
