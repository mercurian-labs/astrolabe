/**
 * How a link finds its file, on the server and on every client alike. A document's identity is
 * its path from the wiki's root; a link is a search, in the order Obsidian 1.15 was seen to use,
 * raw-text matches included. Clients run this, so it stays free of `toSorted` and of `\p{}`.
 */

/** Paths and names compare case-insensitively after Unicode normalization. */
export const key = (name: string): string => name.normalize("NFC").toLowerCase();

export const noteName = (file: string): string => file.replace(/\.md$/i, "");

/** Anything under a dot-folder, or a dot-file. A link reaches it only by its exact path. */
export const isHidden = (file: string): boolean =>
  file.split("/").some((part) => part.startsWith("."));

/**
 * A path a wiki can hold, whatever its extension: relative, every folder a real one, nothing git
 * keeps for itself. Dot-folders are fine; `.git` never is.
 */
export const isWikiPath = (file: string): boolean =>
  file !== "" &&
  !/[\\\0\r\n]/.test(file) &&
  !/^[a-z]:/i.test(file) &&
  file
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== ".." && key(part) !== ".git");

const folderOf = (file: string): string => file.slice(0, Math.max(file.lastIndexOf("/"), 0));

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface ListedFile {
  readonly file: string;
  readonly path: string;
}

/** A file list made ready to search, which a link can be resolved against at no cost per file. */
export interface WikiLinkFiles {
  readonly byPath: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Hidden files are left out: only an exact path reaches them. */
  readonly byName: ReadonlyMap<string, ReadonlyArray<ListedFile>>;
}

export function linkFiles(files: Iterable<string>): WikiLinkFiles {
  const byPath = new Map<string, string[]>();
  const byName = new Map<string, ListedFile[]>();
  for (const file of [...files].sort(byCodeUnit)) {
    const path = key(file);
    byPath.set(path, [...(byPath.get(path) ?? []), file]);
    if (isHidden(file)) continue;
    const list = byName.get(nameOf(path)) ?? [];
    list.push({ file, path });
    byName.set(nameOf(path), list);
  }
  return { byPath, byName };
}

export interface ResolvedLink {
  /** The file the link opens; null for a red link. */
  readonly file: string | null;
  /** What else the search matched, in byte order: the link is ambiguous when there are any. */
  readonly others: ReadonlyArray<string>;
}

const UNRESOLVED: ResolvedLink = { file: null, others: [] };

/** A link's path: no heading, no alias, in a Markdown table's `\|` too. */
const linkPath = (target: string): string =>
  (target.split(/\\?\|/)[0] ?? "").split("#")[0]?.trim() ?? "";

const isRelative = (path: string) => path.startsWith("./") || path.startsWith("../");

const fromRoot = (path: string) => path.replace(/^\/+/, "");

/** `path` joined to `folder`; `..` stops at the root. */
function joined(folder: string, path: string): string {
  const parts = folder === "" ? [] : folder.split("/");
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

/**
 * The files a path can mean. With no dot in its name, only a note. With one, itself first: a dot
 * doesn't always start an extension, and a flat wiki's `[[Release 1.2]]` finds `Release 1.2.md`.
 */
function spellings(path: string): ReadonlyArray<string> {
  const name = nameOf(path);
  if (!name.includes(".")) return [`${path}.md`];
  return /\.md$/i.test(name) ? [path] : [path, `${path}.md`];
}

/** Exact spelling first, since a case-sensitive server can hold `Name.md` beside `name.md`. */
function atPath(path: string, files: WikiLinkFiles): string | null {
  const found = files.byPath.get(key(path));
  if (found === undefined) return null;
  return found.includes(path) ? path : (found[0] ?? null);
}

function search(path: string, folder: string, files: WikiLinkFiles): ResolvedLink | null {
  const exact = atPath(path, files);
  if (exact !== null) return { file: exact, others: [] };
  const wanted = key(path);
  const candidates = (files.byName.get(nameOf(wanted)) ?? []).filter((entry) =>
    entry.path.endsWith(wanted),
  );
  const within = key(folder);
  const near = within === "" ? [] : candidates.filter((entry) => entry.path.startsWith(within));
  let best: ListedFile | undefined;
  // The list is in byte order, so the first of the shortest is the tie's winner.
  for (const entry of near.length > 0 ? near : candidates) {
    if (best === undefined || entry.file.length < best.file.length) best = entry;
  }
  if (best === undefined) return null;
  const chosen = best.file;
  return { file: chosen, others: candidates.flatMap(({ file }) => (file === chosen ? [] : file)) };
}

/**
 * The file `target` opens when written in `from`. A leading `/` is an exact path; `./` and `../`
 * join the linker's folder and forget the linker. An exact path wins; else the files ending in
 * the text, those under the linker's folder first, shortest path, then byte order.
 */
export function resolveLink(
  target: string,
  from: string | null,
  files: WikiLinkFiles,
): ResolvedLink {
  const text = linkPath(target);
  if (text !== target.trim()) {
    // A path can hold what would otherwise start a heading or an alias.
    const whole = atPath(fromRoot(target.trim()), files);
    if (whole !== null) return { file: whole, others: [] };
  }
  if (fromRoot(text) === "") return UNRESOLVED;
  if (text.startsWith("/")) {
    for (const path of spellings(fromRoot(text))) {
      const exact = atPath(path, files);
      if (exact !== null) return { file: exact, others: [] };
    }
    return UNRESOLVED;
  }
  const folder = folderOf(from ?? "");
  const path = isRelative(text) ? joined(folder, text) : text;
  if (path === "") return UNRESOLVED;
  for (const spelling of spellings(path)) {
    const found = search(spelling, isRelative(text) ? "" : folder, files);
    if (found !== null) return found;
  }
  return UNRESOLVED;
}

/**
 * Where a link that resolves nowhere would be written: with a folder in it, that path from the
 * root; without one, beside the linker.
 */
export function unwrittenFile(target: string, from: string | null): string {
  const text = linkPath(target);
  const folder = folderOf(from ?? "");
  const path = text.startsWith("/")
    ? fromRoot(text)
    : isRelative(text)
      ? joined(folder, text)
      : text.includes("/")
        ? text
        : joined(folder, text);
  return /\.(md|base|canvas)$/i.test(path) ? path : `${path}.md`;
}
