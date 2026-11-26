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

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** A note, a skill map, a base or a canvas, in any folder. */
export const isWikiDocument = (file: string): boolean =>
  (file.endsWith(".md") || file.endsWith(".base") || file.endsWith(".canvas")) && isWikiPath(file);

/** What opens as a wiki's own document: anything else, a skill map too, opens as a file. */
export const isDocumentFile = (file: string): boolean =>
  isWikiDocument(file) && !file.endsWith(".skillmap.md");

/** The folder `file` is in, with `end` after it unless that's the root. */
export const folderOf = (file: string, end = ""): string => {
  const folder = file.slice(0, Math.max(file.lastIndexOf("/"), 0));
  return folder === "" ? "" : `${folder}${end}`;
};

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

/**
 * A link's path: no heading, no alias, in a Markdown table's `\|` too. What starts with `/` is a
 * whole path already, as clients read a file and a parsed link comes: `#` and `|` are its own.
 */
export const linkPath = (target: string): string => {
  const text = target.trim();
  return text.startsWith("/") ? text : ((text.split(/\\?\|/)[0] ?? "").split("#")[0]?.trim() ?? "");
};

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
    for (const path of spellings(fromRoot(target.trim()))) {
      const whole = atPath(path, files);
      if (whole !== null) return { file: whole, others: [] };
    }
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
 * What a link writes for `file`, by Obsidian's `shortest`: the bare name when no other file has it
 * or the file is at the root, else the whole path, never a shorter piece of it.
 */
export function shortestLink(file: string, files: WikiLinkFiles): string {
  const whole = noteName(file);
  const sharing = files.byName.get(nameOf(key(file))) ?? [];
  const alone = !isHidden(file) && sharing.every((entry) => entry.file === file);
  return alone ? noteName(nameOf(file)) : whole;
}

/** A link's inside as a new one writes it: `|title` when the path says more than the title. */
export function writtenLink(file: string, files: WikiLinkFiles): string {
  const text = shortestLink(file, files);
  const title = noteName(nameOf(file));
  return text === title ? text : `${text}|${title}`;
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

/** A document in a project: its root's key and its path from that root. */
export interface ProjectFile {
  readonly root: string;
  readonly file: string;
}

/** Each of a project's roots, by key, made ready to search. */
export type ProjectLinkFiles = ReadonlyMap<string, WikiLinkFiles>;

export function projectLinkFiles(
  roots: Iterable<readonly [root: string, files: Iterable<string>]>,
): ProjectLinkFiles {
  return new Map([...roots].map(([root, files]) => [root, linkFiles(files)] as const));
}

/** Where a link is written: the linking file's root, and the file, if any. */
export interface ProjectLinker {
  readonly root: string;
  readonly file: string | null;
}

export interface ResolvedProjectLink {
  /** The file the link opens; null for a red link and for an ambiguous one. */
  readonly file: ProjectFile | null;
  /** What else the chosen root's search matched, as `ResolvedLink.others`. */
  readonly others: ReadonlyArray<ProjectFile>;
  /** Every match, root by root, when a bare link misses its own root and finds several others. */
  readonly ambiguous: ReadonlyArray<ProjectFile>;
}

const UNRESOLVED_IN_PROJECT: ResolvedProjectLink = { file: null, others: [], ambiguous: [] };

const inRoot = (root: string, found: ResolvedLink): ResolvedProjectLink => ({
  file: found.file === null ? null : { root, file: found.file },
  others: found.others.map((file) => ({ root, file })),
  ambiguous: [],
});

/**
 * `root:rest` when the text before the first `:` is exactly a known root's key; else null, so
 * `[[Note: subtitle]]` stays a note's name.
 */
export function rootPrefix(
  target: string,
  roots: { readonly has: (root: string) => boolean },
): { readonly root: string; readonly rest: string } | null {
  const text = target.trim();
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  const root = text.slice(0, colon);
  return roots.has(root) ? { root, rest: text.slice(colon + 1) } : null;
}

/**
 * The file `target` opens across a project. The linking root's own search always comes first, so
 * no other root can retarget a link that lands there. Then `root:` names a root to search alone.
 * Else a bare name or path takes the one other root that has it; several are ambiguous, never
 * picked. A `/`, `./` or `../` path names a place in its own root and searches nowhere else.
 */
export function resolveProjectLink(
  target: string,
  from: ProjectLinker,
  files: ProjectLinkFiles,
): ResolvedProjectLink {
  const own = files.get(from.root);
  if (own !== undefined) {
    const found = resolveLink(target, from.file, own);
    if (found.file !== null) return inRoot(from.root, found);
  }
  const prefixed = rootPrefix(target, files);
  if (prefixed !== null) {
    const there = files.get(prefixed.root);
    if (there === undefined) return UNRESOLVED_IN_PROJECT;
    const linker = prefixed.root === from.root ? from.file : null;
    return inRoot(prefixed.root, resolveLink(prefixed.rest, linker, there));
  }
  if (/^(?:\/|\.\.?\/)/.test(linkPath(target))) return UNRESOLVED_IN_PROJECT;
  const matches: ResolvedProjectLink[] = [];
  for (const [root, rootFiles] of files) {
    if (root === from.root) continue;
    const found = inRoot(root, resolveLink(target, null, rootFiles));
    if (found.file !== null) matches.push(found);
  }
  const [only, ...rest] = matches;
  if (only === undefined) return UNRESOLVED_IN_PROJECT;
  if (rest.length === 0) return only;
  return {
    file: null,
    others: [],
    ambiguous: matches.flatMap((match) =>
      match.file === null ? [] : [match.file, ...match.others],
    ),
  };
}

/** What a link to `target` writes from `fromRoot`: its shortest form, after `root:` elsewhere. */
export function shortestProjectLink(
  target: ProjectFile,
  fromRoot: string,
  files: ProjectLinkFiles,
): string {
  const text = shortestLink(target.file, files.get(target.root) ?? linkFiles([]));
  return target.root === fromRoot ? text : `${target.root}:${text}`;
}

/** A project link's inside as a new one writes it: `|title` when the text says more than that. */
export function writtenProjectLink(
  target: ProjectFile,
  fromRoot: string,
  files: ProjectLinkFiles,
): string {
  const text = shortestProjectLink(target, fromRoot, files);
  const title = noteName(nameOf(target.file));
  return text === title ? text : `${text}|${title}`;
}

/** Where a project link that resolves nowhere would be written: the root it names, else its own. */
export function unwrittenProjectFile(
  target: string,
  from: ProjectLinker,
  roots: { readonly has: (root: string) => boolean },
): ProjectFile {
  const prefixed = rootPrefix(target, roots);
  if (prefixed === null) return { root: from.root, file: unwrittenFile(target, from.file) };
  const linker = prefixed.root === from.root ? from.file : null;
  return { root: prefixed.root, file: unwrittenFile(prefixed.rest, linker) };
}
