/** Note identity: names compare case-insensitively after Unicode normalization. */
export const key = (name: string): string => name.normalize("NFC").toLowerCase();

export const noteName = (file: string): string => file.replace(/\.md$/i, "");

export interface WikiLink {
  readonly target: string;
  readonly index: number;
  readonly raw: string;
  readonly inner: string;
}

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
    const target = noteName((inner.split("|")[0] ?? "").split("#")[0]?.trim() ?? "");
    if (target) found.push({ target, index: match.index ?? 0, raw: match[0], inner });
  }
  return found;
}

/** Rewrites every real link to `from` so it points at `to`, keeping aliases, headings and `.md`. */
export function renameLinks(source: string, from: string, to: string): string {
  let output = source;
  for (const link of links(source).toReversed()) {
    if (key(link.target) !== key(from)) continue;
    const boundary = link.inner.search(/[#|]/);
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
