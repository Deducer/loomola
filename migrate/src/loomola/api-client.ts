// HTTP client to the Loomola server. Exactly one endpoint used today.

import type {
  GranolaNoteImportPayload,
  GranolaNoteImportResult,
} from "./types";

export class LoomolaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "LoomolaApiError";
  }
  isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export class LoomolaApi {
  constructor(
    public readonly baseUrl: string,
    public readonly token: string
  ) {}

  async importGranolaNote(
    payload: GranolaNoteImportPayload
  ): Promise<GranolaNoteImportResult> {
    const url = new URL(
      "/api/import/granola/note",
      this.baseUrl
    ).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
      throw new LoomolaApiError(
        `import failed (${res.status})`,
        res.status,
        body
      );
    }
    return (await res.json()) as GranolaNoteImportResult;
  }
}
