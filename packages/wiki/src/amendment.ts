import { key, renameLinks } from "./links.ts";
import {
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
  isWikiDocument,
  support,
  unresolved,
  type WikiFiles,
  type WikiIndexError,
} from "./wikiIndex.ts";

/** Whole new file content per changed file; `null` deletes the file. */
export type WikiChanges = Readonly<Record<string, string | null>>;

export class AmendmentError extends Error {
  override readonly name = "AmendmentError";
}

/** A flat, ordinary wiki filename: no directories, no hidden files, no control characters. */
export function checkFileName(file: string): string {
  if (
    !file ||
    file.includes("/") ||
    file.includes("\\") ||
    /[\0\r\n]/.test(file) ||
    file.startsWith(".") ||
    !file.endsWith(".md")
  ) {
    throw new AmendmentError(`Expected a flat markdown filename: ${file}`);
  }
  return file;
}

export interface AmendmentStamp {
  /** The amendment's id, recorded on every warning it stamps. */
  readonly amendment: string;
  /** ISO time of the amendment. */
  readonly at: string;
  /** Mints one id per new warning. */
  readonly newId: () => string;
}

export interface PlannedAmendment {
  /** The changes to commit, including any map whose warnings this amendment stamped. */
  readonly changes: WikiChanges;
  /** Index errors standing after the amendment (stale edges included). */
  readonly errors: ReadonlyArray<WikiIndexError>;
}

const applyChanges = (files: WikiFiles, changes: WikiChanges): Record<string, string> => {
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
  const malformed = nextIndex.errors.filter((error) => !error.edge);
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
      if (support(nextIndex, edge).length) continue;
      const existing = previous?.edges.find((candidate) => sameEdge(candidate, edge));
      if (!existing && !options.allowUnstamped) {
        throw new AmendmentError(`New map edge lacks prose support: ${edge.from} ↔ ${edge.to}`);
      }
      const brokenNow = existing !== undefined && support(oldIndex, existing).length > 0;
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
  | { readonly kind: "rename"; readonly from: string; readonly to: string }
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
    };

export function planTransform(
  files: WikiFiles,
  transform: WikiTransform,
  stamp: Pick<AmendmentStamp, "amendment" | "at">,
): WikiChanges {
  const index = indexFiles(files);
  const malformed = index.errors.filter((error) => !error.edge);
  if (malformed.length)
    throw new AmendmentError(`Fix malformed maps first: ${JSON.stringify(malformed)}`);
  const changes: Record<string, string | null> = {};
  if (transform.kind === "rename") {
    const from = index.notes.get(key(transform.from));
    if (!from) throw new AmendmentError(`No note named ${transform.from}`);
    const target = checkFileName(`${transform.to}.md`);
    if (
      index.notes.has(key(transform.to)) ||
      Object.keys(files).some((f) => key(f) === key(target))
    ) {
      throw new AmendmentError(`Rename target exists: ${transform.to}`);
    }
    for (const note of index.notes.values()) {
      const source = renameLinks(note.source, from.name, transform.to);
      if (note.name === from.name) {
        changes[note.file] = null;
        changes[target] = source;
      } else if (source !== note.source) {
        changes[note.file] = source;
      }
    }
    for (const [mapFile, map] of index.maps) {
      const renamed: SkillMap = {
        ...map,
        edges: map.edges.map((edge) => ({
          ...edge,
          from: key(edge.from) === key(from.name) ? transform.to : edge.from,
          to: key(edge.to) === key(from.name) ? transform.to : edge.to,
        })),
        body: renameLinks(map.body ?? "", from.name, transform.to),
      };
      const next = serializeMap(renamed);
      if (next !== serializeMap(map)) changes[mapFile] = next;
    }
    return changes;
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
      !support(index, warning.edge).length
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
