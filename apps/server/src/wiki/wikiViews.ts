/**
 * Pure readings of a wiki's derived index: the shapes the service returns to
 * clients and agents. Nothing here touches git.
 *
 * @module wikiViews
 */
import {
  backlinks,
  baseBlocks,
  canvasMatches,
  canvasSourceOutline,
  documentFile,
  findMap,
  isCanvasFile,
  isHidden,
  isWikiDocument,
  key,
  linkDestination,
  linkedDocument,
  noteName,
  parseCanvas,
  resolveLink,
  support,
  typedLinks,
  typesTo,
  unresolved,
  walk,
  type CanvasMatch,
  type WikiFiles,
  type WikiIndex,
} from "@mercurian/wiki";
import type {
  WikiChangeRequestDetail,
  WikiId,
  WikiIndexResult,
  WikiNoteResult,
  WikiQueryInput,
} from "@t3tools/contracts";

/** Each distinct document a note or canvas links to, as first written. */
const outgoingTargets = (index: WikiIndex, file: string): ReadonlyArray<string> => {
  const links = (index.notes.get(file) ?? index.canvases.get(file))?.links ?? [];
  const seen = new Map<string, string>();
  for (const link of links) {
    const id = linkDestination(index, link, file) ?? key(link.target);
    if (!seen.has(id)) seen.set(id, link.target);
  }
  return [...seen.values()];
};

export const indexResult = (
  wikiId: WikiId,
  commit: string,
  index: WikiIndex,
  editTimes: ReadonlyMap<string, string> = new Map(),
): WikiIndexResult => {
  const incoming = new Map<string, Set<string>>();
  const links: Array<{ from: string; to: string }> = [];
  const linkTypes = new Set<string>();
  /** Records a document's links, returning how many documents they reach. */
  const follow = (
    name: string,
    file: string,
    outgoing: ReadonlyArray<{ readonly target: string; readonly card?: "text" | "file" }>,
  ) => {
    const reached = new Set<string>();
    for (const link of outgoing) {
      const landed = linkDestination(index, link, file);
      const id = landed ?? key(link.target);
      if (reached.has(id)) continue;
      reached.add(id);
      links.push({ from: name, to: landed === null ? link.target : noteName(landed) });
      const sources = incoming.get(id) ?? new Set<string>();
      sources.add(file);
      incoming.set(id, sources);
    }
    return reached.size;
  };
  const notes = [...index.notes.values()].map((note) => {
    const outgoing = follow(note.name, note.file, note.links);
    for (const link of typedLinks(note.source, note.links)) {
      for (const type of link.types) linkTypes.add(type);
    }
    const editedAt = editTimes.get(note.file);
    return {
      name: note.name,
      file: note.file,
      outgoing,
      ...(editedAt === undefined ? {} : { editedAt }),
    };
  });
  const canvases = [...index.canvases.values()].map(({ file, links: outgoing }) => {
    const editedAt = editTimes.get(file);
    return {
      file,
      outgoing: follow(file, file, outgoing),
      ...(editedAt === undefined ? {} : { editedAt }),
    };
  });
  return {
    wikiId,
    commit,
    notes: notes.map((note) => ({ ...note, incoming: incoming.get(note.file)?.size ?? 0 })),
    links,
    linkTypes: [...linkTypes].toSorted((a, b) => a.localeCompare(b)),
    bases: [...index.bases.keys()].map((file) => {
      const editedAt = editTimes.get(file);
      return editedAt === undefined ? { file } : { file, editedAt };
    }),
    canvases: canvases.map((canvas) => ({
      ...canvas,
      incoming: incoming.get(canvas.file)?.size ?? 0,
    })),
    maps: [...index.maps].map(([file, map]) => ({
      file,
      name: map.name,
      purpose: map.purpose,
      edgeCount: map.edges.length,
      openWarnings: (map.warnings ?? []).filter((warning) => !warning.resolution).length,
    })),
    unresolved: unresolved(index).map((entry) => ({ name: entry.name, sources: entry.sources })),
    errors: index.errors,
  };
};

/** Names that searched and found more than one document: the one taken, and the rest. */
const ambiguousLinks = (
  index: WikiIndex,
  file: string,
  requested: string,
): NonNullable<WikiNoteResult["ambiguous"]> => {
  const written = (index.notes.get(file) ?? index.canvases.get(file))?.links ?? [];
  const named = [
    { target: requested, from: null },
    ...written.flatMap((link) =>
      "card" in link && link.card === "file" ? [] : [{ target: link.target, from: file }],
    ),
  ];
  const seen = new Set<string>();
  return named.flatMap(({ target, from }) => {
    const { file: chosen, others } = resolveLink(target, from, index.documents);
    if (chosen === null || others.length === 0 || seen.has(key(target))) return [];
    seen.add(key(target));
    return [{ target, file: chosen, others }];
  });
};

/**
 * A note, or any other wiki document such as a skill map, by what a link from the root would
 * find; a client names a file with a leading `/`. A canvas reads as its outline.
 */
export const noteResult = (
  wikiId: WikiId,
  commit: string,
  index: WikiIndex,
  files: WikiFiles,
  requested: string,
): WikiNoteResult => {
  const file = documentFile(index, requested);
  const ambiguous = ambiguousLinks(index, file, requested);
  const ambiguity = ambiguous.length === 0 ? {} : { ambiguous };
  const canvas = index.canvases.get(file);
  if (canvas !== undefined) {
    return {
      wikiId,
      commit,
      name: canvas.file,
      file: canvas.file,
      exists: true,
      source: canvasSourceOutline(canvas.file, canvas.source),
      outgoing: outgoingTargets(index, canvas.file),
      incoming: backlinks(index, `/${canvas.file}`),
      ...ambiguity,
    };
  }
  const source = files[file];
  return {
    wikiId,
    commit,
    name: noteName(file),
    file,
    exists: source !== undefined,
    source: source ?? "",
    outgoing: outgoingTargets(index, file),
    incoming: backlinks(index, `/${file}`),
    ...ambiguity,
  };
};

const MAX_LISTED_ENTRIES = 200;

/** What's directly in one folder, by path from the root. A subfolder counts all it holds. */
export interface WikiFolderListing {
  readonly folder: string;
  readonly folders: ReadonlyArray<{ readonly path: string; readonly documents: number }>;
  readonly documents: ReadonlyArray<string>;
  /** Anything else, such as images a note can embed. */
  readonly files: ReadonlyArray<string>;
  /** True when the folder holds more than the listing carries. */
  readonly truncated: boolean;
}

/** `folder`'s contents among `files`, the root for `""`; null when nothing is there. */
export const folderListing = (
  files: ReadonlyArray<string>,
  folder: string,
): WikiFolderListing | null => {
  const path = folder.trim().replace(/^\/+|\/+$/g, "");
  const prefix = path === "" ? "" : `${key(path)}/`;
  const subfolders = new Map<string, number>();
  const documents: string[] = [];
  const others: string[] = [];
  let found: string | undefined;
  for (const file of files) {
    if (isHidden(file) || !key(file).startsWith(prefix)) continue;
    found ??= file.slice(0, prefix.length);
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      const subfolder = file.slice(0, prefix.length + slash);
      const held = subfolders.get(subfolder) ?? 0;
      subfolders.set(subfolder, held + (isWikiDocument(file) ? 1 : 0));
    } else {
      (isWikiDocument(file) ? documents : others).push(file);
    }
  }
  if (found === undefined && path !== "") return null;
  const folders = [...subfolders].map(([subfolder, count]) => ({
    path: subfolder,
    documents: count,
  }));
  return {
    folder: (found ?? "").replace(/\/$/, ""),
    folders: folders.slice(0, MAX_LISTED_ENTRIES),
    documents: documents.slice(0, MAX_LISTED_ENTRIES),
    files: others.slice(0, MAX_LISTED_ENTRIES),
    truncated: Math.max(folders.length, documents.length, others.length) > MAX_LISTED_ENTRIES,
  };
};

/** Where a query's base comes from: its YAML, and the file `this` names inside it. */
export type LocatedBase =
  | { readonly source: string; readonly self: string | undefined }
  | { readonly problem: "not-found" | "invalid"; readonly message: string };

/**
 * A `.base` file, else a note's first ```base block, by `base`; or `source` as a block in
 * `note` holds it, unsaved edits and all.
 */
export const locateBase = (
  index: WikiIndex,
  input: Pick<WikiQueryInput, "base" | "source" | "note">,
): LocatedBase => {
  if ((input.base === undefined) === (input.source === undefined)) {
    return { problem: "invalid", message: "Name a base, or give a base's source; not both." };
  }
  const self = input.note === undefined ? null : documentFile(index, input.note);
  if (input.source !== undefined) {
    return { source: input.source, self: self ?? undefined };
  }
  const name = input.base ?? "";
  for (const candidate of [name, `${name}.base`]) {
    const file = linkedDocument(index, candidate, self);
    const source = file === null ? undefined : index.bases.get(file);
    if (file !== null && source !== undefined) return { source, self: file };
  }
  const note = index.notes.get(linkedDocument(index, name, self) ?? "");
  if (note === undefined) {
    return { problem: "not-found", message: `No base or note is named ${name}.` };
  }
  const [block] = baseBlocks(note.source);
  return block === undefined
    ? { problem: "invalid", message: `${note.name} holds no \`\`\`base block.` }
    : { source: block, self: note.file };
};

export interface WikiLinksResult {
  readonly name: string;
  readonly exists: boolean;
  readonly outgoing: ReadonlyArray<{
    readonly target: string;
    readonly unresolved: boolean;
    readonly types: ReadonlyArray<string>;
  }>;
  readonly backlinks: ReadonlyArray<string>;
  /** The backlinks that say what they mean: each source with its `@` types for this note. */
  readonly typedBacklinks: ReadonlyArray<{
    readonly source: string;
    readonly types: ReadonlyArray<string>;
  }>;
  /** The wiki's red links: names linked to that no note carries yet. */
  readonly unresolved: ReadonlyArray<{
    readonly name: string;
    readonly sources: ReadonlyArray<string>;
  }>;
}

export const linksResult = (index: WikiIndex, requested: string): WikiLinksResult => {
  const file = documentFile(index, requested);
  const note = index.notes.get(file);
  const typedBacklinks = [...index.notes.values()].flatMap((source) => {
    const types = typesTo(index, source, file);
    return types ? [{ source: source.name, types }] : [];
  });
  return {
    name: index.canvases.has(file) ? file : noteName(file),
    exists: note !== undefined || index.canvases.has(file),
    outgoing: outgoingTargets(index, file).map((target) => ({
      target,
      unresolved: linkedDocument(index, target, file) === null,
      types: (note && typesTo(index, note, documentFile(index, target, file))) ?? [],
    })),
    backlinks: backlinks(index, `/${file}`),
    typedBacklinks,
    unresolved: unresolved(index),
  };
};

export interface WikiOrientEdge {
  readonly from: string;
  readonly type: string;
  readonly to: string;
  readonly rationale: string;
  readonly meaning: string;
  readonly supportingProse: {
    readonly note: string;
    readonly line: number;
    readonly prose: string;
  } | null;
  readonly otherLocations: ReadonlyArray<{ readonly note: string; readonly line: number }>;
}

export interface WikiOrientResult {
  readonly file: string;
  readonly name: string;
  readonly purpose: string;
  readonly teaching: string;
  readonly walk: string;
  readonly edges: ReadonlyArray<WikiOrientEdge>;
  readonly warnings: ReadonlyArray<{
    readonly id: string;
    readonly edge: { readonly from: string; readonly type: string; readonly to: string };
    readonly resolved: boolean;
  }>;
  readonly errors: WikiIndexResult["errors"];
}

/** A skill map read for orientation: its teaching, its walk, and the prose under every edge. */
export const orientResult = (index: WikiIndex, mapName: string): WikiOrientResult | undefined => {
  const found = findMap(index, mapName);
  if (!found) return undefined;
  const [file, map] = found;
  return {
    file,
    name: map.name,
    purpose: map.purpose,
    teaching: map.body ?? "",
    walk: walk(map, index, file),
    edges: map.edges.map((edge) => {
      const evidence = support(index, edge, file);
      return {
        from: edge.from,
        type: edge.type,
        to: edge.to,
        rationale: edge.rationale,
        meaning: map.types[edge.type] ?? "",
        supportingProse: evidence[0] ?? null,
        otherLocations: evidence.slice(1).map(({ note, line }) => ({ note, line })),
      };
    }),
    warnings: (map.warnings ?? []).map((warning) => ({
      id: warning.id,
      edge: warning.edge,
      resolved: warning.resolution !== undefined,
    })),
    errors: index.errors.filter((error) => error.file === file),
  };
};

const MAX_SEARCH_NOTES = 40;
const MAX_LINES_PER_NOTE = 5;
const MAX_LINE_LENGTH = 240;

export interface WikiSearchResult {
  readonly matches: ReadonlyArray<{
    readonly name: string;
    readonly lines: ReadonlyArray<{ readonly line: number; readonly text: string }>;
    /** A canvas's matches: cards, which have ids to edit them by, not lines. */
    readonly cards?: ReadonlyArray<CanvasMatch>;
  }>;
  /** True when more documents, lines or cards matched than the result carries. */
  readonly truncated: boolean;
}

const clipped = (text: string) =>
  text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text;

/** Case-insensitive substring search over document names and text, bounded for an agent's context. */
export const searchNotes = (index: WikiIndex, query: string): WikiSearchResult => {
  const needle = query.toLowerCase();
  const matches: Array<WikiSearchResult["matches"][number]> = [];
  let truncated = false;
  // A hidden document is read only by its exact path, which search never offers.
  const documents: ReadonlyArray<{ readonly name: string; readonly source: string }> = [
    ...index.notes.values(),
    ...[...index.canvases.values()].map(({ file, source }) => ({ name: file, source })),
  ].filter(({ name }) => !isHidden(name));
  for (const { name, source } of documents) {
    const board = isCanvasFile(name) ? parseCanvas(source) : null;
    if (board?.ok === true) {
      const cards = canvasMatches(board.data, query);
      if (cards.length === 0 && !name.toLowerCase().includes(needle)) continue;
      if (matches.length >= MAX_SEARCH_NOTES) {
        truncated = true;
        break;
      }
      truncated ||= cards.length > MAX_LINES_PER_NOTE;
      matches.push({
        name,
        lines: [],
        cards: cards
          .slice(0, MAX_LINES_PER_NOTE)
          .map((card) => ({ ...card, text: clipped(card.text) })),
      });
      continue;
    }
    const lines: Array<{ line: number; text: string }> = [];
    let more = false;
    source.split("\n").forEach((text, position) => {
      if (!text.toLowerCase().includes(needle)) return;
      if (lines.length >= MAX_LINES_PER_NOTE) {
        more = true;
        return;
      }
      lines.push({ line: position + 1, text: clipped(text) });
    });
    if (!lines.length && !name.toLowerCase().includes(needle)) continue;
    if (matches.length >= MAX_SEARCH_NOTES) {
      truncated = true;
      break;
    }
    truncated ||= more;
    matches.push({ name, lines });
  }
  return { matches, truncated };
};

/** A change request as agents review it: a canvas's files as outlines, not coordinates. */
export const withCanvasOutlines = (detail: WikiChangeRequestDetail): WikiChangeRequestDetail => ({
  ...detail,
  files: detail.files.map((change) => {
    if (!isCanvasFile(change.file)) return change;
    const outline = (source: string | null) =>
      source === null ? null : canvasSourceOutline(change.file, source);
    return { ...change, before: outline(change.before), after: outline(change.after) };
  }),
});
