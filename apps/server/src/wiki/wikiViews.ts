/**
 * Pure readings of a wiki's derived index: the shapes the service returns to
 * clients and agents. Nothing here touches git.
 *
 * @module wikiViews
 */
import {
  backlinks,
  baseBlocks,
  canvasSourceOutline,
  documentFile,
  findMap,
  isCanvasFile,
  key,
  linkDestination,
  linkedDocument,
  linkFiles,
  noteName,
  projectBacklinks,
  projectLinkDestination,
  renameLinks,
  resolveLink,
  resolveProjectLink,
  support,
  typedLinks,
  typesTo,
  unresolved,
  unwrittenProjectFile,
  walk,
  type ProjectFile,
  type ProjectIndex,
  type WikiFiles,
  type WikiIndex,
} from "@mercurian/wiki";
import type {
  WikiChangeRequestDetail,
  ProjectRootId,
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
  wikiId: ProjectRootId,
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

/**
 * What the Projects tree's Docs filter keeps of a root: every document, and each of `others` (the
 * files that aren't documents) a note's link or embed, wikilink or Markdown, or a canvas's card
 * leads to.
 */
export const docPaths = (
  index: WikiIndex,
  others: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const files = linkFiles(others);
  const linked = new Set<string>();
  const follow = (target: string, from: string) => {
    const file = resolveLink(target, from, files).file;
    if (file !== null) linked.add(file);
  };
  for (const note of index.notes.values()) {
    // Visits every link's target, wikilink or Markdown, and rewrites none.
    renameLinks(note.source, (target) => {
      follow(target, note.file);
      return null;
    });
  }
  for (const canvas of index.canvases.values()) {
    for (const link of canvas.links) {
      follow(link.card === "file" ? `/${link.target}` : link.target, canvas.file);
    }
  }
  return [
    ...index.notes.keys(),
    ...index.maps.keys(),
    ...index.bases.keys(),
    ...index.canvases.keys(),
    ...linked,
  ].toSorted();
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
  wikiId: ProjectRootId,
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

/** A project document as tools name it: `root:path`. */
export const projectAddress = ({ root, file }: ProjectFile) => `${root}:${file}`;

const sameFile = (a: ProjectFile | null, b: ProjectFile) =>
  a !== null && a.root === b.root && a.file === b.file;

export type ProjectDocumentLookup =
  | { readonly kind: "found"; readonly file: ProjectFile }
  | { readonly kind: "ambiguous"; readonly matches: ReadonlyArray<ProjectFile> }
  /** Where writing it would land. */
  | { readonly kind: "missing"; readonly file: ProjectFile };

/**
 * The document `name` means in `root`, or with no root its one match in the project, as a bare
 * link finds it. A miss lands in `root`, else `fallbackRoot`.
 */
export const lookupProjectDocument = (
  index: ProjectIndex,
  name: string,
  root: string | null,
  fallbackRoot: string,
): ProjectDocumentLookup => {
  const own = root === null ? undefined : index.documents.get(root);
  const searched =
    root === null ? index.documents : own === undefined ? new Map() : new Map([[root, own]]);
  const found = resolveProjectLink(name, { root: root ?? "", file: null }, searched);
  if (found.file !== null) return { kind: "found", file: found.file };
  if (found.ambiguous.length > 0) return { kind: "ambiguous", matches: found.ambiguous };
  const into = root ?? fallbackRoot;
  return {
    kind: "missing",
    file: unwrittenProjectFile(name, { root: into, file: null }, new Set([into])),
  };
};

export interface ProjectLinksResult {
  readonly repository: string;
  readonly name: string;
  readonly exists: boolean;
  readonly outgoing: ReadonlyArray<{
    readonly target: string;
    /** The document it opens; null for a red link and for an ambiguous one. */
    readonly to: string | null;
    readonly unresolved: boolean;
    /** The documents an ambiguous bare link could mean, in several roots. */
    readonly ambiguous?: ReadonlyArray<string>;
    readonly types: ReadonlyArray<string>;
  }>;
  readonly backlinks: ReadonlyArray<string>;
  readonly typedBacklinks: ReadonlyArray<{
    readonly source: string;
    readonly types: ReadonlyArray<string>;
  }>;
  /** The project's red links: names linked to that no document carries yet. */
  readonly unresolved: ReadonlyArray<{
    readonly name: string;
    readonly sources: ReadonlyArray<string>;
  }>;
}

/** `WikiLinksResult` across every root of a project, each document named by its address. */
export const projectLinksResult = (index: ProjectIndex, file: ProjectFile): ProjectLinksResult => {
  type Link = { readonly target: string; readonly card?: "text" | "file" };
  const destination = (link: Link, from: ProjectFile) => projectLinkDestination(index, link, from);
  const leadsTo = (link: Link, from: ProjectFile, target: ProjectFile) => {
    const landed = destination(link, from);
    if (landed.file !== null) return sameFile(landed.file, target);
    if (landed.ambiguous.length > 0) return false;
    const unwritten = unwrittenProjectFile(link.target, from, index.documents);
    return unwritten.root === target.root && key(unwritten.file) === key(target.file);
  };
  const rootIndex = index.roots.get(file.root);
  const note = rootIndex?.notes.get(file.file);
  const canvas = rootIndex?.canvases.get(file.file);
  const typed = note === undefined ? [] : typedLinks(note.source, note.links);
  const seen = new Set<string>();
  const outgoing: Array<ProjectLinksResult["outgoing"][number]> = [];
  for (const link of note?.links ?? canvas?.links ?? []) {
    const landed = destination(link, file);
    const id = landed.file === null ? `\0${key(link.target)}` : projectAddress(landed.file);
    if (seen.has(id)) continue;
    seen.add(id);
    const types = typed.filter((each) =>
      landed.file === null
        ? key(each.target) === key(link.target)
        : sameFile(destination(each, file).file, landed.file),
    );
    outgoing.push({
      target: link.target,
      to: landed.file === null ? null : projectAddress(landed.file),
      unresolved: landed.file === null && landed.ambiguous.length === 0,
      ...(landed.ambiguous.length > 0 ? { ambiguous: landed.ambiguous.map(projectAddress) } : {}),
      types: [...new Set(types.flatMap((each) => each.types))],
    });
  }
  const typedBacklinks: Array<ProjectLinksResult["typedBacklinks"][number]> = [];
  const missing = new Map<string, { name: string; sources: string[] }>();
  for (const [root, each] of index.roots) {
    for (const source of each.notes.values()) {
      const from = { root, file: source.file };
      const types = typedLinks(source.source, source.links).filter((link) =>
        leadsTo(link, from, file),
      );
      if (types.length > 0) {
        typedBacklinks.push({
          source: projectAddress(from),
          types: [...new Set(types.flatMap((link) => link.types))],
        });
      }
    }
    const sources = [
      ...[...each.notes.values()].map((source) => ({ file: source.file, links: source.links })),
      ...[...each.canvases.values()].map((source) => ({
        file: source.file,
        links: source.links.filter((link) => link.card === "text"),
      })),
    ];
    for (const source of sources) {
      for (const link of source.links) {
        const landed = destination(link, { root, file: source.file });
        if (landed.file !== null || landed.ambiguous.length > 0) continue;
        const entry = missing.get(key(link.target)) ?? { name: link.target, sources: [] };
        const named = projectAddress({ root, file: source.file });
        if (!entry.sources.includes(named)) entry.sources.push(named);
        missing.set(key(link.target), entry);
      }
    }
  }
  return {
    repository: file.root,
    name: projectAddress(file),
    exists: note !== undefined || canvas !== undefined,
    outgoing,
    backlinks: projectBacklinks(index, file).map(projectAddress),
    typedBacklinks,
    unresolved: [...missing.values()],
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
