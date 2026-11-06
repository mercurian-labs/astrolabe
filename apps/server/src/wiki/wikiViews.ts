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
  findMap,
  isCanvasFile,
  isDocumentLink,
  key,
  noteName,
  parseCanvas,
  support,
  unresolved,
  typedLinks,
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

/** Each distinct link target of a note or canvas, as first written, compared case-insensitively. */
const outgoingTargets = (index: WikiIndex, name: string): ReadonlyArray<string> => {
  const links = (index.notes.get(key(name)) ?? index.canvases.get(key(name)))?.links ?? [];
  const seen = new Map<string, string>();
  for (const link of links)
    if (!seen.has(key(link.target))) seen.set(key(link.target), link.target);
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
  const follow = (name: string) => {
    const targets = outgoingTargets(index, name);
    for (const target of targets) {
      links.push({ from: name, to: target });
      const sources = incoming.get(key(target)) ?? new Set<string>();
      sources.add(key(name));
      incoming.set(key(target), sources);
    }
    return targets;
  };
  const notes = [...index.notes.values()].map((note) => {
    const targets = follow(note.name);
    for (const link of typedLinks(note.source, note.links)) {
      for (const type of link.types) linkTypes.add(type);
    }
    const editedAt = editTimes.get(note.file);
    return {
      name: note.name,
      file: note.file,
      outgoing: targets.length,
      ...(editedAt === undefined ? {} : { editedAt }),
    };
  });
  const canvases = [...index.canvases.values()].map(({ file }) => {
    const editedAt = editTimes.get(file);
    return {
      file,
      outgoing: follow(file).length,
      ...(editedAt === undefined ? {} : { editedAt }),
    };
  });
  return {
    wikiId,
    commit,
    notes: notes.map((note) => ({ ...note, incoming: incoming.get(key(note.name))?.size ?? 0 })),
    links,
    linkTypes: [...linkTypes].toSorted((a, b) => a.localeCompare(b)),
    bases: [...index.bases.keys()].map((file) => {
      const editedAt = editTimes.get(file);
      return editedAt === undefined ? { file } : { file, editedAt };
    }),
    canvases: canvases.map((canvas) => ({
      ...canvas,
      incoming: incoming.get(key(canvas.file))?.size ?? 0,
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

/** A note, or any other wiki document such as a skill map, read by name. A canvas reads as its outline. */
export const noteResult = (
  wikiId: WikiId,
  commit: string,
  index: WikiIndex,
  files: WikiFiles,
  requested: string,
): WikiNoteResult => {
  const canvas = index.canvases.get(key(requested));
  if (canvas !== undefined) {
    return {
      wikiId,
      commit,
      name: canvas.file,
      file: canvas.file,
      exists: true,
      source: canvasSourceOutline(canvas.file, canvas.source),
      outgoing: outgoingTargets(index, canvas.file),
      incoming: backlinks(index, canvas.file),
    };
  }
  const name = noteName(requested);
  const note = index.notes.get(key(name));
  const document =
    note === undefined
      ? Object.keys(files).find((file) => key(file) === key(`${name}.md`))
      : undefined;
  return {
    wikiId,
    commit,
    name: note?.name ?? (document === undefined ? name : noteName(document)),
    file: note?.file ?? document ?? `${name}.md`,
    exists: note !== undefined || document !== undefined,
    source: note?.source ?? (document === undefined ? "" : (files[document] ?? "")),
    outgoing: outgoingTargets(index, name),
    incoming: backlinks(index, name),
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
  if (input.source !== undefined) {
    if (input.note === undefined) return { source: input.source, self: undefined };
    const note = index.notes.get(key(noteName(input.note)));
    return { source: input.source, self: note?.file ?? `${noteName(input.note)}.md` };
  }
  const name = input.base ?? "";
  const wanted = [key(name), key(`${name}.base`)];
  for (const candidate of wanted) {
    for (const [file, source] of index.bases) {
      if (key(file) === candidate) return { source, self: file };
    }
  }
  const note = index.notes.get(key(noteName(name)));
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
  const canvas = index.canvases.get(key(requested));
  const name = canvas?.file ?? noteName(requested);
  const note = index.notes.get(key(name));
  const typed = note ? typedLinks(note.source, note.links) : [];
  const typedBacklinks = [...index.notes.values()].flatMap((source) => {
    const types = typedLinks(source.source, source.links).find(
      (link) => key(link.target) === key(name),
    )?.types;
    return types ? [{ source: source.name, types }] : [];
  });
  return {
    name: note?.name ?? name,
    exists: note !== undefined || canvas !== undefined,
    outgoing: outgoingTargets(index, name).map((target) => ({
      target,
      unresolved: !isDocumentLink(index, target),
      types: typed.find((link) => key(link.target) === key(target))?.types ?? [],
    })),
    backlinks: backlinks(index, name),
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
    walk: walk(map, index),
    edges: map.edges.map((edge) => {
      const evidence = support(index, edge);
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
  const documents: ReadonlyArray<{ readonly name: string; readonly source: string }> = [
    ...index.notes.values(),
    ...[...index.canvases.values()].map(({ file, source }) => ({ name: file, source })),
  ];
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
