export const DEFAULT_OBSIDIAN_VAULT_PATH =
  "/Users/iancross/Obsidian_Vaults/The Vault/0 - Inbox";

export function normalizeObsidianPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed === "/") return trimmed;
  return trimmed.replace(/[\\/]+$/g, "");
}

export function globalDefaultObsidianPath(): string {
  return (
    normalizeObsidianPath(process.env.OBSIDIAN_DEFAULT_VAULT_PATH) ??
    DEFAULT_OBSIDIAN_VAULT_PATH
  );
}

export function resolveObsidianPath(params: {
  overridePath?: string | null;
  projectPath?: string | null;
}): string {
  return (
    normalizeObsidianPath(params.overridePath) ??
    normalizeObsidianPath(params.projectPath) ??
    globalDefaultObsidianPath()
  );
}
