import type { DictionaryTerm } from "@/db/queries/dictionary-terms";
import type { WordTimestamp } from "@/db/queries/transcripts";

export function buildVariantReplacementMap(
  terms: Pick<DictionaryTerm, "id" | "term" | "variantOf">[]
): Map<string, string> {
  const byId = new Map(terms.map((term) => [term.id, term]));
  const replacements = new Map<string, string>();

  for (const term of terms) {
    if (!term.variantOf) continue;
    const canonical = byId.get(term.variantOf);
    if (!canonical) continue;
    replacements.set(term.term.toLowerCase(), canonical.term);
  }

  return replacements;
}

export function collapseDictionaryVariants(
  fullText: string,
  words: WordTimestamp[],
  replacements: Map<string, string>
): { fullText: string; words: WordTimestamp[] } {
  if (replacements.size === 0) return { fullText, words };

  const rewrittenWords = words.map((word) => ({
    ...word,
    word: rewriteToken(word.word, replacements),
  }));

  let rewrittenText = fullText;
  for (const [variant, canonical] of replacements) {
    rewrittenText = rewrittenText.replace(
      new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(variant)}(?![A-Za-z0-9])`, "gi"),
      canonical
    );
  }

  return { fullText: rewrittenText, words: rewrittenWords };
}

function rewriteToken(token: string, replacements: Map<string, string>) {
  const match = token.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
  if (!match) return token;
  const [, prefix, core, suffix] = match;
  const replacement = replacements.get(core.toLowerCase());
  return replacement ? `${prefix}${replacement}${suffix}` : token;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
