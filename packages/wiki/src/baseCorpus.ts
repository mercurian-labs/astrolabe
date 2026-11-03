/**
 * Every file in a wiki's repository as a base sees it, the way an Obsidian vault does: notes in
 * any folder, bases, canvases and attachments. Notes give properties, tags and links; canvases
 * give links; anything else only its file fields. Dot-folders, such as `.git` and `.obsidian`,
 * are left out, as Obsidian leaves them out.
 */
import { fileName, stripHeading, type BaseDoc, type LinkValue } from "./baseValues.ts";
import { key, links as findLinks } from "./links.ts";
import { noteProperties, noteTags } from "./properties.ts";

export interface BaseFile {
  readonly file: string;
  /** The text of a note or canvas; other files need none. */
  readonly source?: string;
  /** Bytes; measured from `source` when absent. */
  readonly size?: number;
}

export interface BaseFileTimes {
  /** Times of the last and first commit that touched each file: ISO text or epoch milliseconds. */
  readonly modified?: ReadonlyMap<string, string | number>;
  readonly created?: ReadonlyMap<string, string | number>;
}

export interface BaseCorpus {
  /** Sorted by path. */
  readonly docs: ReadonlyArray<BaseDoc>;
  readonly byPath: (path: string) => BaseDoc | undefined;
  /** The file link text points at, as Obsidian resolves it. */
  readonly resolve: (path: string) => BaseDoc | undefined;
  /** The files linking to `doc`, sorted by path. */
  readonly backlinks: (doc: BaseDoc) => ReadonlyArray<BaseDoc>;
}

const encoder = new TextEncoder();
const isNote = (file: string) => /\.md$/i.test(file);
export const isHidden = (file: string): boolean =>
  file.split("/").some((part) => part.startsWith("."));

/** A link as a note's prose or frontmatter writes it, with the text Obsidian shows for it. */
function linkOf(inner: string): LinkValue {
  const bar = inner.indexOf("|");
  const path = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  const alias = bar < 0 ? undefined : inner.slice(bar + 1);
  const display = alias ?? path.replace(/#/g, " > ").replace(/\s+>\s+/g, " > ");
  return { kind: "link", path, display };
}

function noteLinks(source: string): { links: LinkValue[]; embeds: LinkValue[] } {
  const links: LinkValue[] = [];
  const embeds: LinkValue[] = [];
  for (const link of findLinks(source)) {
    const value = linkOf(link.inner);
    links.push(value);
    if (source[link.index - 1] === "!") embeds.push(value);
  }
  return { links, embeds };
}

/** A canvas's links: those its text cards write, then the files its file cards show. */
function canvasLinks(source: string): LinkValue[] {
  let nodes: unknown;
  try {
    nodes = (JSON.parse(source) as { nodes?: unknown }).nodes;
  } catch {
    return [];
  }
  if (!Array.isArray(nodes)) return [];
  const cards = nodes.filter(
    (node): node is Record<string, unknown> => typeof node === "object" && node !== null,
  );
  const fromText = cards.flatMap((node) =>
    node.type === "text" && typeof node.text === "string" ? noteLinks(node.text).links : [],
  );
  const fromFiles = cards.flatMap((node): LinkValue[] =>
    node.type === "file" && typeof node.file === "string"
      ? [{ kind: "link", path: node.file }]
      : [],
  );
  return [...fromText, ...fromFiles];
}

const timeOf = (times: ReadonlyMap<string, string | number> | undefined, file: string) => {
  const at = times?.get(file);
  const time = at === undefined ? Number.NaN : typeof at === "number" ? at : Date.parse(at);
  return Number.isNaN(time) ? undefined : time;
};

function docOf(entry: BaseFile, times: BaseFileTimes): BaseDoc {
  const source = entry.source ?? "";
  const size = entry.size ?? encoder.encode(source).length;
  const base = {
    file: entry.file,
    source,
    size,
    mtime: timeOf(times.modified, entry.file),
    ctime: timeOf(times.created, entry.file),
  };
  if (isNote(entry.file)) {
    const properties = noteProperties(source);
    return { ...base, properties, tags: noteTags(source, properties), ...noteLinks(source) };
  }
  const links = /\.canvas$/i.test(entry.file) ? canvasLinks(source) : [];
  return { ...base, properties: {}, tags: [], links, embeds: [] };
}

const collate = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function baseCorpus(files: Iterable<BaseFile>, times: BaseFileTimes = {}): BaseCorpus {
  const docs = [...files]
    .filter((entry) => !isHidden(entry.file))
    .map((entry) => docOf(entry, times))
    .toSorted((a, b) => collate(a.file, b.file));
  const byPathKey = new Map<string, BaseDoc>();
  // Each file under its full name (`diagram.png`) and, for a note, its name without `.md`.
  const byName = new Map<string, BaseDoc[]>();
  for (const doc of docs) {
    byPathKey.set(key(doc.file), doc);
    const names = [fileName(doc.file)];
    if (isNote(doc.file)) names.push(fileName(doc.file).replace(/\.md$/i, ""));
    for (const name of names) {
      const found = byName.get(key(name)) ?? [];
      found.push(doc);
      byName.set(key(name), found);
    }
  }
  const resolved = new Map<string, BaseDoc | undefined>();
  const resolve = (raw: string): BaseDoc | undefined => {
    const path = stripHeading(raw).replace(/^\/+/, "");
    if (!path) return undefined;
    const cacheKey = key(path);
    if (resolved.has(cacheKey)) return resolved.get(cacheKey);
    let doc = byPathKey.get(cacheKey) ?? byPathKey.get(`${cacheKey}.md`);
    if (doc === undefined && !path.includes("/")) {
      // Obsidian picks the closest to the vault's root when several files share a name.
      doc = (byName.get(cacheKey) ?? []).toSorted(
        (a, b) => a.file.split("/").length - b.file.split("/").length || collate(a.file, b.file),
      )[0];
    }
    if (doc === undefined && path.includes("/")) {
      const suffix = `/${cacheKey}`;
      doc = docs.find((candidate) => {
        const file = key(candidate.file);
        return file.endsWith(suffix) || file.endsWith(`${suffix}.md`);
      });
    }
    resolved.set(cacheKey, doc);
    return doc;
  };
  const backlinkMap = new Map<BaseDoc, Set<BaseDoc>>();
  for (const doc of docs) {
    for (const link of doc.links) {
      const target = resolve(link.path);
      if (target === undefined) continue;
      const sources = backlinkMap.get(target) ?? new Set<BaseDoc>();
      sources.add(doc);
      backlinkMap.set(target, sources);
    }
  }
  return {
    docs,
    byPath: (path) => byPathKey.get(key(path)),
    resolve,
    backlinks: (doc) => [...(backlinkMap.get(doc) ?? [])],
  };
}

/**
 * The corpus with whole-file `changes` applied, as a read of them would see it: changed files
 * keep the times they had, new files have none.
 */
export function corpusWithChanges(
  corpus: BaseCorpus,
  changes: Readonly<Record<string, string | null>>,
): BaseCorpus {
  const modified = new Map<string, number>();
  const created = new Map<string, number>();
  const files: BaseFile[] = [];
  for (const doc of corpus.docs) {
    if (doc.mtime !== undefined) modified.set(doc.file, doc.mtime);
    if (doc.ctime !== undefined) created.set(doc.file, doc.ctime);
    if (doc.file in changes) continue;
    // Only notes and canvases carry text; any other file is its size.
    files.push(
      /\.(md|canvas)$/i.test(doc.file)
        ? { file: doc.file, source: doc.source }
        : { file: doc.file, size: doc.size },
    );
  }
  for (const [file, content] of Object.entries(changes)) {
    if (content !== null) files.push({ file, source: content });
  }
  return baseCorpus(files, { modified, created });
}
