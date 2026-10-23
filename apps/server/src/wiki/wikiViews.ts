/**
 * Pure readings of a wiki's derived index: the shapes the service returns to
 * clients and agents. Nothing here touches git.
 *
 * @module wikiViews
 */
import {
  backlinks,
  findMap,
  key,
  noteName,
  support,
  unresolved,
  walk,
  type WikiFiles,
  type WikiIndex,
} from "@mercurian/wiki";
import type { WikiId, WikiIndexResult, WikiNoteResult } from "@t3tools/contracts";

/** Each distinct link target of a note, as first written, compared case-insensitively. */
const outgoingTargets = (index: WikiIndex, name: string): ReadonlyArray<string> => {
  const note = index.notes.get(key(name));
  if (!note) return [];
  const seen = new Map<string, string>();
  for (const link of note.links)
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
  const notes = [...index.notes.values()].map((note) => {
    const targets = outgoingTargets(index, note.name);
    for (const target of targets) {
      links.push({ from: note.name, to: target });
      const sources = incoming.get(key(target)) ?? new Set<string>();
      sources.add(key(note.name));
      incoming.set(key(target), sources);
    }
    const editedAt = editTimes.get(note.file);
    return {
      name: note.name,
      file: note.file,
      outgoing: targets.length,
      ...(editedAt === undefined ? {} : { editedAt }),
    };
  });
  return {
    wikiId,
    commit,
    notes: notes.map((note) => ({ ...note, incoming: incoming.get(key(note.name))?.size ?? 0 })),
    links,
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

/** A note, or any other wiki document such as a skill map, read by name. */
export const noteResult = (
  wikiId: WikiId,
  commit: string,
  index: WikiIndex,
  files: WikiFiles,
  requested: string,
): WikiNoteResult => {
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

export interface WikiLinksResult {
  readonly name: string;
  readonly exists: boolean;
  readonly outgoing: ReadonlyArray<{ readonly target: string; readonly unresolved: boolean }>;
  readonly backlinks: ReadonlyArray<string>;
  /** The wiki's red links: names linked to that no note carries yet. */
  readonly unresolved: ReadonlyArray<{
    readonly name: string;
    readonly sources: ReadonlyArray<string>;
  }>;
}

export const linksResult = (index: WikiIndex, requested: string): WikiLinksResult => {
  const name = noteName(requested);
  return {
    name: index.notes.get(key(name))?.name ?? name,
    exists: index.notes.has(key(name)),
    outgoing: outgoingTargets(index, name).map((target) => ({
      target,
      unresolved: !index.notes.has(key(target)),
    })),
    backlinks: backlinks(index, name),
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
  }>;
  /** True when more notes or lines matched than the result carries. */
  readonly truncated: boolean;
}

/** Case-insensitive substring search over note names and text, bounded for an agent's context. */
export const searchNotes = (index: WikiIndex, query: string): WikiSearchResult => {
  const needle = query.toLowerCase();
  const matches: Array<WikiSearchResult["matches"][number]> = [];
  let truncated = false;
  for (const note of index.notes.values()) {
    const lines: Array<{ line: number; text: string }> = [];
    let more = false;
    note.source.split("\n").forEach((text, position) => {
      if (!text.toLowerCase().includes(needle)) return;
      if (lines.length >= MAX_LINES_PER_NOTE) {
        more = true;
        return;
      }
      lines.push({
        line: position + 1,
        text: text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text,
      });
    });
    if (!lines.length && !note.name.toLowerCase().includes(needle)) continue;
    if (matches.length >= MAX_SEARCH_NOTES) {
      truncated = true;
      break;
    }
    truncated ||= more;
    matches.push({ name: note.name, lines });
  }
  return { matches, truncated };
};
