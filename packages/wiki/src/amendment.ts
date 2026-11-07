import { applyBaseEdits, type BaseEdit } from "./baseEdits.ts";
import { renameInBase, renameInBaseBlocks } from "./bases.ts";
import { isCanvasFile, parseCanvas, serializeCanvas } from "./canvas.ts";
import { applyCanvasEdits, CanvasEditError, type CanvasEdit } from "./canvasEdits.ts";
import { renameInCanvas } from "./canvasIndex.ts";
import { key, noteName, renameLinks } from "./links.ts";
import {
  folderOf,
  isWikiDocument,
  isWikiPath,
  linkFiles,
  resolveLink,
  shortestLink,
} from "./resolveLink.ts";
import {
  isMapFile,
  sameEdge,
  serializeMap,
  type MapEdge,
  type MapEdgeRef,
  type MapWarning,
  type SkillMap,
} from "./skillMap.ts";
import {
  findMap,
  indexFiles,
  linkedDocument,
  support,
  unresolved,
  type WikiFiles,
  type WikiIndex,
  type WikiIndexError,
} from "./wikiIndex.ts";

/** Whole new file content per changed file; `null` deletes the file. */
export type WikiChanges = Readonly<Record<string, string | null>>;

export class AmendmentError extends Error {
  override readonly name = "AmendmentError";
}

/** A document's path: every segment is one a wiki can hold, and it ends in a document's type. */
export function checkFileName(file: string): string {
  if (
    !isWikiPath(file) ||
    !(file.endsWith(".md") || file.endsWith(".base") || file.endsWith(".canvas"))
  ) {
    throw new AmendmentError(`Expected a path to a .md, .base or .canvas file: ${file}`);
  }
  return file;
}

/** Index errors that make the maps unreadable, which no amendment may leave or build on. */
const malformedMaps = (errors: ReadonlyArray<WikiIndexError>) =>
  errors.filter((error) => !error.edge && isMapFile(error.file));

const refuseMalformedMaps = (index: WikiIndex) => {
  const malformed = malformedMaps(index.errors);
  if (malformed.length) {
    throw new AmendmentError(`Fix malformed maps first: ${JSON.stringify(malformed)}`);
  }
};

export interface AmendmentStamp {
  /** The amendment's id, recorded on every warning it stamps. */
  readonly amendment: string;
  /** ISO time of the amendment. */
  readonly at: string;
  /** Mints one id per new warning. */
  readonly newId: () => string;
}

/** A file a document shows, such as a pasted image: bytes that are nobody's text. */
export interface WikiAttachment {
  readonly file: string;
  readonly bytes: Uint8Array;
}

export interface PlannedAmendment {
  /** The changes to commit, including any map whose warnings this amendment stamped. */
  readonly changes: WikiChanges;
  readonly attachment?: WikiAttachment;
  /** Index errors standing after the amendment (stale edges included). */
  readonly errors: ReadonlyArray<WikiIndexError>;
  /** What a canvas transform reports, returned with the amendment. */
  readonly canvas?: {
    readonly file: string;
    readonly cards: PlannedCanvasEdits["cards"];
    readonly notes?: PlannedCanvasEdits["notes"];
  };
}

/** `files` with `changes` applied. */
export const applyChanges = (files: WikiFiles, changes: WikiChanges): Record<string, string> => {
  const next: Record<string, string> = { ...files };
  for (const [file, content] of Object.entries(changes)) {
    if (content === null) delete next[file];
    else next[file] = content;
  }
  return next;
};

/**
 * Checks an amendment against every skill map and stamps what it severed. A change that breaks
 * a map edge's prose link records a warning in that map's own file in the same amendment; a new
 * edge with no prose support is refused, unless `allowUnstamped` (a revert) says otherwise.
 * Warning history is append-only: an amendment may add a resolution, never erase a record.
 */
export function planAmendment(
  files: WikiFiles,
  changes: WikiChanges,
  stamp: AmendmentStamp,
  options: { readonly allowUnstamped?: boolean } = {},
): PlannedAmendment {
  if (!Object.keys(changes).length) throw new AmendmentError("No amendment changes");
  for (const [file, content] of Object.entries(changes)) {
    checkFileName(file);
    if (content !== null && typeof content !== "string") {
      throw new AmendmentError(`${file}: content must be text or null`);
    }
  }
  const oldIndex = indexFiles(files);
  const nextIndex = indexFiles(applyChanges(files, changes));
  const malformed = malformedMaps(nextIndex.errors);
  if (malformed.length) throw new AmendmentError(`Malformed maps: ${JSON.stringify(malformed)}`);

  const nextChanges: Record<string, string | null> = { ...changes };
  for (const [mapFile, map] of nextIndex.maps) {
    const previous = oldIndex.maps.get(mapFile);
    const warnings: MapWarning[] = [...(map.warnings ?? [])];
    for (const warning of previous?.warnings ?? []) {
      const retained = warnings.find((w) => w.id === warning.id);
      const { resolution: _r, ...retainedRecord } = retained ?? ({} as MapWarning);
      const { resolution: _p, ...previousRecord } = warning;
      if (
        !retained ||
        JSON.stringify(retainedRecord) !== JSON.stringify(previousRecord) ||
        (warning.resolution &&
          JSON.stringify(retained.resolution) !== JSON.stringify(warning.resolution))
      ) {
        throw new AmendmentError(`Do not erase or rewrite warning history in ${mapFile}`);
      }
    }
    let stamped = false;
    for (const edge of map.edges) {
      if (support(nextIndex, edge, mapFile).length) continue;
      const existing = previous?.edges.find((candidate) => sameEdge(candidate, edge));
      if (!existing && !options.allowUnstamped) {
        throw new AmendmentError(`New map edge lacks prose support: ${edge.from} ↔ ${edge.to}`);
      }
      const brokenNow = existing !== undefined && support(oldIndex, existing, mapFile).length > 0;
      const alreadyStanding = warnings.some((w) => sameEdge(w.edge, edge) && !w.resolution);
      if (brokenNow || !alreadyStanding) {
        warnings.push({
          id: stamp.newId(),
          amendment: stamp.amendment,
          at: stamp.at,
          edge: { from: edge.from, type: edge.type, to: edge.to },
        });
        stamped = true;
      }
    }
    if (stamped) nextChanges[mapFile] = serializeMap({ ...map, warnings });
  }
  return { changes: nextChanges, errors: indexFiles(applyChanges(files, nextChanges)).errors };
}

/** Mechanical transforms: each computes a complete set of changes, reviewed like any other. */
export type WikiTransform =
  | {
      readonly kind: "rename";
      readonly from: string;
      readonly to: string;
      readonly folder?: boolean | undefined;
    }
  | { readonly kind: "map-put"; readonly file: string; readonly map: SkillMap }
  | {
      readonly kind: "edge-add";
      readonly map: string;
      readonly edge: MapEdge;
      readonly meaning?: string | undefined;
    }
  | { readonly kind: "edge-remove"; readonly map: string; readonly edge: MapEdgeRef }
  | {
      readonly kind: "fill";
      readonly map: string;
      readonly name: string;
      readonly content: string;
      readonly edge: MapEdge;
      readonly meaning?: string | undefined;
    }
  | {
      readonly kind: "resolve-warning";
      readonly map: string;
      readonly id: string;
      readonly text: string;
    }
  /** Edits made from a base's view (see `applyBaseEdits`). */
  | { readonly kind: "base-edits"; readonly edits: ReadonlyArray<BaseEdit> }
  /** A new canvas: empty, or holding `source`, a board whose coordinates are already decided. */
  | { readonly kind: "canvas-create"; readonly file: string; readonly source?: string | undefined };

/** Edits to one canvas, replayed on the head under the wiki's lock. */
export interface CanvasTransform {
  readonly file: string;
  readonly edits: ReadonlyArray<CanvasEdit>;
}

export interface PlannedCanvasEdits {
  readonly file: string;
  readonly changes: WikiChanges;
  readonly cards: Readonly<Record<string, string>>;
  readonly notes: ReadonlyArray<string>;
}

/** A canvas transform as changes to the wiki's files, with the ids it minted. */
export function planCanvasEdits(
  files: WikiFiles,
  transform: CanvasTransform,
  stamp: Pick<AmendmentStamp, "amendment">,
): PlannedCanvasEdits {
  const file = checkFileName(transform.file.trim());
  if (!isCanvasFile(file)) throw new AmendmentError(`Expected a .canvas filename: ${file}`);
  const existing = Object.keys(files).find((name) => key(name) === key(file));
  try {
    const { source, cards, notes } = applyCanvasEdits(
      existing ?? file,
      existing === undefined ? null : (files[existing] ?? null),
      transform.edits,
      stamp.amendment,
    );
    return { file: existing ?? file, changes: { [existing ?? file]: source }, cards, notes };
  } catch (error) {
    if (error instanceof CanvasEditError) throw new AmendmentError(error.message);
    throw error;
  }
}

/** A file that isn't a document, as a folder carries it: its bytes are nobody's text. */
export interface WikiBlob {
  readonly file: string;
  readonly oid: string;
}

/** A move's changes, and the blobs of what isn't a document at each path, null removing one. */
export interface PlannedMove {
  readonly changes: WikiChanges;
  readonly blobs: Readonly<Record<string, string | null>>;
}

/** What a link becomes when `moves` happen: null leaves it. */
function linkRewriter(
  files: ReadonlyArray<string>,
  moves: ReadonlyMap<string, string>,
): (linker: string) => (target: string, embed: boolean) => string | null {
  const before = linkFiles(files);
  const after = linkFiles(files.map((file) => moves.get(file) ?? file));
  return (linker) => {
    const movedLinker = moves.get(linker) ?? linker;
    return (target, embed) => {
      const landed = resolveLink(target, linker, before).file;
      if (landed === null) return null;
      const destination = moves.get(landed) ?? landed;
      const stays = resolveLink(target, movedLinker, after).file === destination;
      // A moved file's links take the written form; anything else keeps working as it stands.
      if (stays && (embed || !moves.has(landed))) return null;
      const text = shortestLink(destination, after);
      return text === target ? null : text;
    };
  };
}

function applyMoves(
  files: WikiFiles,
  others: ReadonlyArray<WikiBlob>,
  moves: ReadonlyMap<string, string>,
  inBases?: (linker: string) => (name: string) => string | null,
): PlannedMove {
  const index = indexFiles(files);
  refuseMalformedMaps(index);
  const rewrite = linkRewriter([...Object.keys(files), ...others.map(({ file }) => file)], moves);
  const paths = new Map([...moves].map(([from, to]) => [key(from), to]));
  const changes: Record<string, string | null> = {};
  const put = (file: string, source: string, next: string) => {
    const moved = moves.get(file);
    if (moved !== undefined) {
      changes[file] = null;
      changes[moved] = next;
    } else if (next !== source) {
      changes[file] = next;
    }
  };
  for (const note of index.notes.values()) {
    const moved = renameLinks(note.source, rewrite(note.file));
    const literal = inBases?.(note.file);
    put(note.file, note.source, literal ? renameInBaseBlocks(moved, literal) : moved);
  }
  for (const canvas of index.canvases.values()) {
    const next = renameInCanvas(canvas.source, {
      path: (file) => paths.get(key(file)) ?? null,
      link: rewrite(canvas.file),
    });
    put(canvas.file, canvas.source, next);
  }
  for (const [baseFile, source] of index.bases) {
    put(baseFile, source, inBases ? renameInBase(source, inBases(baseFile)) : source);
  }
  for (const [mapFile, map] of index.maps) {
    const rename = rewrite(mapFile);
    const renamed: SkillMap = {
      ...map,
      edges: map.edges.map((edge) => ({
        ...edge,
        from: rename(edge.from, false) ?? edge.from,
        to: rename(edge.to, false) ?? edge.to,
      })),
      body: renameLinks(map.body ?? "", rename),
    };
    const next = serializeMap(renamed);
    const source = files[mapFile] ?? "";
    put(mapFile, source, next === serializeMap(map) ? source : next);
  }
  const blobs: Record<string, string | null> = {};
  for (const { file, oid } of others) {
    const moved = moves.get(file);
    if (moved === undefined) continue;
    blobs[file] = null;
    blobs[moved] = oid;
  }
  return { changes, blobs };
}

/** The type a document keeps through a move: a new name can't turn a note into a board. */
const documentType = (file: string) =>
  /\.skillmap\.md$/i.exec(file)?.[0] ?? /\.(md|base|canvas)$/i.exec(file)?.[0] ?? "";

/** `to` in full: a bare name stays in `file`'s folder, and a path is from the root. */
function movedPath(file: string, to: string): string {
  const path = to.includes("/") ? to.replace(/^\/+/, "") : `${folderOf(file, "/")}${to}`;
  const type = documentType(file);
  return key(path).endsWith(key(type)) ? path : `${path}${type}`;
}

const taken = (
  files: WikiFiles,
  others: ReadonlyArray<WikiBlob>,
  path: string,
  except: string | null = null,
) =>
  [...Object.keys(files), ...others.map(({ file }) => file)].some(
    (file) => file !== except && key(file) === key(path),
  );

/**
 * Moves or renames one document as an amendment. Every link that led to it comes back in the form
 * a new link would take; any other link it would have captured gets its whole path. A note's
 * attachments stay, as Obsidian leaves them. A rename in place also follows base literals.
 */
export function planRename(
  files: WikiFiles,
  others: ReadonlyArray<WikiBlob>,
  from: string,
  to: string,
): PlannedMove {
  const index = indexFiles(files);
  const { file: fromFile, others: rivals } = resolveLink(from, null, index.documents);
  if (fromFile === null) throw new AmendmentError(`No document named ${from}`);
  if (rivals.length > 0) {
    throw new AmendmentError(
      `${from} could be ${[fromFile, ...rivals].join(" or ")}: name its path`,
    );
  }
  const target = checkFileName(movedPath(fromFile, to));
  if (!isWikiDocument(target)) throw new AmendmentError(`${target} is not a document's name`);
  if (taken(files, others, target, fromFile)) {
    throw new AmendmentError(`Rename target exists: ${to}`);
  }
  if (target === fromFile) throw new AmendmentError(`${from} is already there`);
  const moves = new Map([[fromFile, target]]);
  const inPlace = folderOf(fromFile) === folderOf(target);
  const written = noteName(target.slice(target.lastIndexOf("/") + 1));
  const inBases = (linker: string) => (literal: string) =>
    linkedDocument(index, literal, linker) === fromFile
      ? `${literal.slice(0, literal.lastIndexOf("/") + 1)}${written}`
      : null;
  return applyMoves(files, others, moves, inPlace ? inBases : undefined);
}

/**
 * Renames or moves a folder, as moving each file in it: attachments too, and any file a document
 * doesn't own. A folder has no record of its own, so `to` must not hold anything yet.
 */
export function planFolderRename(
  files: WikiFiles,
  others: ReadonlyArray<WikiBlob>,
  from: string,
  to: string,
): PlannedMove {
  const folder = from.replace(/^\/+|\/+$/g, "");
  const destination = to.replace(/^\/+|\/+$/g, "");
  if (!isWikiPath(destination)) throw new AmendmentError(`Not a folder's path: ${to}`);
  if (key(destination).startsWith(`${key(folder)}/`)) {
    throw new AmendmentError(`${from} can't move inside itself`);
  }
  const all = [...Object.keys(files), ...others.map(({ file }) => file)];
  const held = all.filter((file) => file.startsWith(`${folder}/`));
  if (held.length === 0) throw new AmendmentError(`No folder named ${from}`);
  if (destination === folder) throw new AmendmentError(`${from} is already there`);
  const landing = key(destination);
  const clash = all.find(
    (file) =>
      !file.startsWith(`${folder}/`) &&
      (key(file) === landing || key(file).startsWith(`${landing}/`)),
  );
  if (clash !== undefined) throw new AmendmentError(`Rename target exists: ${to}`);
  const moves = new Map(
    held.map((file) => [file, `${destination}${file.slice(folder.length)}`] as const),
  );
  return applyMoves(files, others, moves);
}

/** A rename, of a document or of a folder, however it was asked for. */
export const planMove = (
  files: WikiFiles,
  others: ReadonlyArray<WikiBlob>,
  { from, to, folder }: Extract<WikiTransform, { readonly kind: "rename" }>,
): PlannedMove =>
  (folder === true ? planFolderRename : planRename)(files, others, from.trim(), to.trim());

export function planTransform(
  files: WikiFiles,
  transform: WikiTransform,
  stamp: Pick<AmendmentStamp, "amendment" | "at">,
): WikiChanges {
  if (transform.kind === "base-edits") {
    try {
      return applyBaseEdits(files, transform.edits);
    } catch (error) {
      throw new AmendmentError(error instanceof Error ? error.message : String(error));
    }
  }
  const index = indexFiles(files);
  refuseMalformedMaps(index);
  const changes: Record<string, string | null> = {};
  if (transform.kind === "canvas-create") {
    const file = checkFileName(transform.file);
    if (!isCanvasFile(file)) throw new AmendmentError(`Expected a .canvas filename: ${file}`);
    if (Object.keys(files).some((existing) => key(existing) === key(file))) {
      throw new AmendmentError(`A file named ${file} already exists`);
    }
    if (transform.source === undefined) {
      changes[file] = serializeCanvas({ nodes: [], edges: [] });
      return changes;
    }
    const parsed = parseCanvas(transform.source);
    if (!parsed.ok) throw new AmendmentError(`${file} isn't valid JSON: ${parsed.error}`);
    changes[file] = serializeCanvas(parsed.document);
    return changes;
  }
  if (transform.kind === "rename") {
    return planMove(files, [], transform).changes;
  }
  if (transform.kind === "map-put") {
    if (!transform.file.endsWith(".skillmap.md")) {
      throw new AmendmentError("Map filename must end in .skillmap.md");
    }
    changes[checkFileName(transform.file)] = serializeMap(transform.map);
    return changes;
  }
  const found = findMap(index, transform.map);
  if (!found) throw new AmendmentError(`No valid map named ${transform.map}`);
  const [mapFile, map] = found;
  let edges = [...map.edges];
  let warnings = [...(map.warnings ?? [])];
  const types = { ...map.types };
  if (transform.kind === "edge-add" || transform.kind === "fill") {
    if (transform.meaning) types[transform.edge.type] = transform.meaning;
    const placed = edges.some((edge) => sameEdge(edge, transform.edge));
    if (placed && transform.kind === "edge-add")
      throw new AmendmentError("Map already contains this edge");
    if (!placed) edges.push(transform.edge);
  }
  if (transform.kind === "edge-remove") {
    const position = edges.findIndex((edge) => sameEdge(edge, transform.edge));
    if (position < 0) throw new AmendmentError("No matching edge");
    edges = edges.filter((_, i) => i !== position);
  }
  if (transform.kind === "fill") {
    if (!unresolved(index).some((note) => key(note.name) === key(transform.name))) {
      throw new AmendmentError("fill requires an existing unresolved reference");
    }
    if (
      key(transform.edge.from) !== key(transform.name) &&
      key(transform.edge.to) !== key(transform.name)
    ) {
      throw new AmendmentError("Placement must include the new note");
    }
    changes[checkFileName(`${transform.name}.md`)] = transform.content;
  }
  if (transform.kind === "resolve-warning") {
    const warning = warnings.find((w) => w.id === transform.id);
    if (!warning || warning.resolution)
      throw new AmendmentError("No unresolved warning with this id");
    if (
      edges.some((edge) => sameEdge(edge, warning.edge)) &&
      !support(index, warning.edge, mapFile).length
    ) {
      throw new AmendmentError("Repair the prose relationship or remove the edge before resolving");
    }
    warnings = warnings.map((w) =>
      w.id === transform.id
        ? { ...w, resolution: { at: stamp.at, amendment: stamp.amendment, text: transform.text } }
        : w,
    );
  }
  changes[mapFile] = serializeMap({
    ...map,
    types,
    edges,
    ...(warnings.length ? { warnings } : {}),
  });
  return changes;
}

/** Restores the warning history a revert's inverse would otherwise drop from a map's file. */
export function keepWarningHistory(files: WikiFiles, changes: WikiChanges): WikiChanges {
  const index = indexFiles(files);
  const next: Record<string, string | null> = { ...changes };
  for (const [mapFile, map] of index.maps) {
    const proposedSource = changes[mapFile];
    if (!map.warnings?.length || typeof proposedSource !== "string") continue;
    const proposed = indexFiles({ [mapFile]: proposedSource }).maps.get(mapFile);
    if (proposed) next[mapFile] = serializeMap({ ...proposed, warnings: map.warnings });
  }
  return next;
}

export const isKnowledgeFile = isWikiDocument;
