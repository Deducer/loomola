const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SLUG_RE = /^[a-zA-Z0-9_-]{3,80}$/;

export type ClipReference =
  | { kind: "id"; value: string }
  | { kind: "slug"; value: string };

export function parseClipReference(input: string): ClipReference | null {
  const value = input.trim();
  if (!value) return null;

  if (UUID_RE.test(value)) return { kind: "id", value };
  if (SLUG_RE.test(value)) return { kind: "slug", value };

  const url = parseMaybeUrl(value);
  if (!url) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const vIndex = parts.indexOf("v");
  if (vIndex >= 0 && parts[vIndex + 1] && SLUG_RE.test(parts[vIndex + 1])) {
    return { kind: "slug", value: parts[vIndex + 1] };
  }

  const recordingsIndex = parts.indexOf("recordings");
  if (
    recordingsIndex >= 0 &&
    parts[recordingsIndex + 1] &&
    UUID_RE.test(parts[recordingsIndex + 1])
  ) {
    return { kind: "id", value: parts[recordingsIndex + 1] };
  }

  return null;
}

function parseMaybeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    if (!value.includes(".")) return null;
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
