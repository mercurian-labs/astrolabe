import { key, links } from "./links.ts";
import { frontmatterEnd } from "./properties.ts";

/** `@` at the start of a link's display text or after a space, so `a@b.com` and `\@a` are text. */
const TYPE_WORD = /(?<!\S)@([\p{L}\p{N}_-]+)/gu;

/** The types a link's display text writes, each with where its `@` sits in that text. */
export function typeWords(
  display: string,
): ReadonlyArray<{ readonly type: string; readonly index: number }> {
  return [...display.matchAll(TYPE_WORD)].map((match) => ({
    type: match[1] ?? "",
    index: match.index,
  }));
}

export interface TypedLink {
  readonly target: string;
  readonly types: ReadonlyArray<string>;
}

/**
 * Each document a note's body links to with types, in first-mention order. Types belong to the
 * document, so its mentions combine. Frontmatter and embeds carry none.
 */
export function typedLinks(source: string): ReadonlyArray<TypedLink> {
  const start = frontmatterEnd(source);
  const found = new Map<string, { target: string; types: string[] }>();
  for (const link of links(source)) {
    if (link.index < start || source[link.index - 1] === "!") continue;
    const bar = link.inner.indexOf("|");
    if (bar < 0) continue;
    for (const { type } of typeWords(link.inner.slice(bar + 1))) {
      const entry = found.get(key(link.target)) ?? { target: link.target, types: [] };
      if (!entry.types.includes(type)) entry.types.push(type);
      found.set(key(link.target), entry);
    }
  }
  return [...found.values()];
}
