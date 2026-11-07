import { key, noteName } from "./resolveLink.ts";

export { key, noteName };

export interface WikiLink {
  readonly target: string;
  readonly index: number;
  readonly raw: string;
  readonly inner: string;
}

export const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Where a note's frontmatter ends; 0 when it has none. */
export const frontmatterEnd = (source: string): number => FRONTMATTER.exec(source)?.[0].length ?? 0;

const blank = (text: string): string => text.replace(/[^\r\n]/g, " ");

/**
 * The note's prose with fenced code, inline code and HTML comments blanked out. Offsets stay
 * intact, so links found here point at real text and examples inside code are never touched.
 */
export function prose(source: string): string {
  let fence: string | undefined;
  let result = "";
  for (const line of source.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (fence !== undefined) {
      result += blank(line);
      const run = marker?.[1];
      if (
        run !== undefined &&
        run[0] === fence[0] &&
        run.length >= fence.length &&
        !marker?.[2]?.trim()
      ) {
        fence = undefined;
      }
    } else if (marker?.[1] !== undefined) {
      fence = marker[1];
      result += blank(line);
    } else {
      result += line;
    }
  }
  result = result.replace(/<!--[\s\S]*?-->/g, blank);
  return result.replace(/(`+)([\s\S]*?)\1(?!`)/g, blank);
}

export function links(source: string): ReadonlyArray<WikiLink> {
  const found: WikiLink[] = [];
  for (const match of prose(source).matchAll(/(?<!\\)\[\[([^\]\n]+)\]\]/g)) {
    const inner = match[1] ?? "";
    // In a Markdown table, a link's bar is written `\\|`.
    const target = noteName((inner.split(/\\?\|/)[0] ?? "").split("#")[0]?.trim() ?? "");
    if (target) found.push({ target, index: match.index ?? 0, raw: match[0], inner });
  }
  return found;
}

/** Rewrites every real link to `from` so it points at `to`, keeping aliases, headings and `.md`. */
export function renameLinks(source: string, from: string, to: string): string {
  let output = source;
  for (const link of links(source).toReversed()) {
    if (key(link.target) !== key(from)) continue;
    const boundary = link.inner.search(/#|\\?\|/);
    const suffix = boundary < 0 ? "" : link.inner.slice(boundary);
    const oldTarget = (boundary < 0 ? link.inner : link.inner.slice(0, boundary)).trim();
    const extension = /\.md$/i.test(oldTarget) ? ".md" : "";
    output =
      output.slice(0, link.index) +
      `[[${to}${extension}${suffix}]]` +
      output.slice(link.index + link.raw.length);
  }
  return output;
}

/** `@` at the start of a display text or after a space, so an address like `a@b.com` is text. */
const TYPE_WORD = /(?<!\S)(\\?)@([\p{L}\p{N}_-]+)/gu;

/** A piece of a link's display text as it reads; what lies between pieces doesn't show. */
export interface DisplayRun {
  readonly from: number;
  readonly to: number;
  /** A link type, without its `@`. */
  readonly type: boolean;
}

/** The display text a reader sees: an `@` type stays where it's written, `\\@` is a plain `@`. */
export function displayRuns(display: string): ReadonlyArray<DisplayRun> {
  const runs: DisplayRun[] = [];
  const add = (from: number, to: number, type: boolean) => {
    if (to > from) runs.push({ from, to, type });
  };
  let at = 0;
  for (const match of display.matchAll(TYPE_WORD)) {
    const end = match.index + match[0].length;
    add(at, match.index, false);
    if (match[1]) add(match.index + 1, end, false);
    else add(match.index + 1, end, true);
    at = end;
  }
  add(at, display.length, false);
  return runs;
}

export interface TypedLink {
  readonly target: string;
  readonly types: ReadonlyArray<string>;
}

/**
 * Each document a note's body links to with types, in first-mention order. Types belong to the
 * document, so its mentions combine. Frontmatter and embeds carry none.
 */
export function typedLinks(
  source: string,
  found: ReadonlyArray<WikiLink> = links(source),
): ReadonlyArray<TypedLink> {
  const start = frontmatterEnd(source);
  const typed = new Map<string, { target: string; types: string[] }>();
  for (const link of found) {
    if (link.index < start || source[link.index - 1] === "!") continue;
    const bar = link.inner.indexOf("|");
    if (bar < 0) continue;
    const display = link.inner.slice(bar + 1);
    for (const run of displayRuns(display)) {
      if (!run.type) continue;
      const entry = typed.get(key(link.target)) ?? { target: link.target, types: [] };
      const type = display.slice(run.from, run.to);
      if (!entry.types.includes(type)) entry.types.push(type);
      typed.set(key(link.target), entry);
    }
  }
  return [...typed.values()];
}
