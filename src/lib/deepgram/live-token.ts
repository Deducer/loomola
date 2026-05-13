export const DEFAULT_LIVE_TOKEN_TTL_SECONDS = 3600;
export const MAX_LIVE_TOKEN_TTL_SECONDS = 3600;

export type DeepgramLiveToken = {
  accessToken: string;
  expiresIn: number;
};

type GrantDeepgramLiveTokenParams = {
  apiKey?: string;
  ttlSeconds?: number;
  fetchImpl?: typeof fetch;
};

export function normalizeLiveTokenTtl(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIVE_TOKEN_TTL_SECONDS;
  }
  return Math.max(1, Math.min(MAX_LIVE_TOKEN_TTL_SECONDS, Math.floor(value)));
}

export async function grantDeepgramLiveToken(
  params: GrantDeepgramLiveTokenParams = {}
): Promise<DeepgramLiveToken> {
  const apiKey = params.apiKey ?? process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set");

  const fetchImpl = params.fetchImpl ?? fetch;
  const ttlSeconds = normalizeLiveTokenTtl(params.ttlSeconds);
  const response = await fetchImpl("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Deepgram token grant failed with ${response.status}`);
  }

  const json = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof json.access_token !== "string" || json.access_token.length === 0) {
    throw new Error("Deepgram token grant response was missing access_token");
  }

  return {
    accessToken: json.access_token,
    expiresIn:
      typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
        ? json.expires_in
        : ttlSeconds,
  };
}
