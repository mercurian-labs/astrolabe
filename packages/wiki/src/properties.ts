import { parseDocument } from "yaml";

import { prose } from "./links.ts";

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Where a note's frontmatter ends; 0 when it has none. */
export const frontmatterEnd = (source: string): number => FRONTMATTER.exec(source)?.[0].length ?? 0;

/**
 * A note's properties: the YAML mapping between `---` lines at its very start, as Obsidian
 * reads them. A note without frontmatter, or with frontmatter that is not a valid mapping, has
 * none.
 */
export function noteProperties(source: string): Readonly<Record<string, unknown>> {
  const match = FRONTMATTER.exec(source);
  if (!match?.[1]) return {};
  const document = parseDocument(match[1], { schema: "core" });
  if (document.errors.length) return {};
  try {
    const data: unknown = document.toJS({ maxAliasCount: 0 });
    return data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// Obsidian's inline tag: `#` after whitespace or the line start, then letters, digits, `_`, `-`,
// or `/` (nesting), with at least one character that is not a digit.
const INLINE_TAG = /(?<=^|\s)#([\p{L}\p{N}_\-/]+)/gu;

/** A note's tags, `#` first, from its `tags` property and the `#tags` in its prose. */
export function noteTags(
  source: string,
  properties: Readonly<Record<string, unknown>>,
): ReadonlyArray<string> {
  const found = new Map<string, string>();
  const add = (raw: string) => {
    const tag = raw.trim().replace(/^#/, "");
    if (tag && /\D/.test(tag) && !found.has(tag.toLowerCase())) {
      found.set(tag.toLowerCase(), `#${tag}`);
    }
  };
  const declared = properties.tags ?? properties.tag;
  for (const value of Array.isArray(declared) ? declared : [declared]) {
    if (typeof value === "string") for (const part of value.split(/[,\s]+/)) add(part);
  }
  const body = prose(source).slice(frontmatterEnd(source));
  for (const match of body.matchAll(INLINE_TAG)) add(match[1] ?? "");
  return [...found.values()];
}

/** Whether `tags` holds `tag` or a tag nested under it, as `#book` holds `#book/fiction`. */
export const hasTag = (tags: ReadonlyArray<string>, tag: string): boolean => {
  const wanted = tag.trim().replace(/^#/, "").toLowerCase();
  return tags.some((candidate) => {
    const name = candidate.slice(1).toLowerCase();
    return name === wanted || name.startsWith(`${wanted}/`);
  });
};
