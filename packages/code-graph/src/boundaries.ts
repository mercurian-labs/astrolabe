/**
 * A codebase's declared boundaries: named layers (path prefixes) and the
 * dependencies allowed between them, read from `.atlas/boundaries.json`.
 *
 *   { "layers": [{ "name": "model", "paths": ["src/model"] }, …],
 *     "allowed": [["render", "model"], …] }
 *
 * A layer's paths are prefixes relative to the folder holding `.atlas/`; the
 * story carries them repository-relative, as its notes' paths are. A link from
 * one layer into another that no allowed pair names is a violation; a link
 * inside one layer never is.
 */
import type { CodeEdge, CodeSymbol } from "./model/code.ts";
import type { Boundaries } from "./model/graph.ts";

export type BoundariesResult = { readonly boundaries: Boundaries } | { readonly error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A prefix under `root`, or null when it is absolute or climbs out. */
function prefixUnder(root: string, prefix: string): string | null {
  const clean = prefix.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (clean === "" || clean.startsWith("/") || clean.split("/").some((part) => part === "..")) {
    return null;
  }
  return root === "" ? clean : `${root}/${clean}`;
}

/** Parse and check a boundaries file whose `.atlas/` folder sits at `root` (repository-relative). */
export function parseBoundaries(text: string, root: string): BoundariesResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { error: `not JSON: ${(error as Error).message}` };
  }
  if (!isRecord(raw) || !Array.isArray(raw.layers) || !Array.isArray(raw.allowed)) {
    return { error: "expected { layers: [...], allowed: [...] }" };
  }
  const layers: Array<{ name: string; paths: Array<string> }> = [];
  for (const [index, layer] of raw.layers.entries()) {
    if (!isRecord(layer) || typeof layer.name !== "string" || layer.name === "") {
      return { error: `layer ${index} needs a name` };
    }
    if (layers.some((known) => known.name === layer.name)) {
      return { error: `layer ${layer.name} is named twice` };
    }
    if (!Array.isArray(layer.paths) || layer.paths.length === 0) {
      return { error: `layer ${layer.name} needs paths` };
    }
    const paths: Array<string> = [];
    for (const path of layer.paths) {
      const prefix = typeof path === "string" ? prefixUnder(root, path) : null;
      if (prefix === null) return { error: `layer ${layer.name} has a bad path: ${String(path)}` };
      paths.push(prefix);
    }
    layers.push({ name: layer.name, paths });
  }
  const names = new Set(layers.map((layer) => layer.name));
  const allowed: Array<readonly [string, string]> = [];
  for (const pair of raw.allowed) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    ) {
      return { error: `an allowed entry is not a [from, to] pair: ${JSON.stringify(pair)}` };
    }
    const [from, to] = pair;
    if (!names.has(from) || !names.has(to)) {
      return { error: `an allowed pair names an unknown layer: ${from} → ${to}` };
    }
    allowed.push([from, to]);
  }
  return { boundaries: { layers, allowed } };
}

/** The layer a path belongs to: the one with the longest matching prefix, or none. */
export function layerOf(boundaries: Boundaries, path: string): string | null {
  let found: string | null = null;
  let longest = -1;
  for (const layer of boundaries.layers) {
    for (const prefix of layer.paths) {
      const matches = path === prefix || path.startsWith(`${prefix}/`);
      if (matches && prefix.length > longest) {
        found = layer.name;
        longest = prefix.length;
      }
    }
  }
  return found;
}

/** The links that cross from one layer into another without an allowed pair. */
export function violations(
  boundaries: Boundaries,
  edges: ReadonlyArray<CodeEdge>,
  symbols: ReadonlyMap<string, CodeSymbol>,
): ReadonlyArray<CodeEdge> {
  const allowed = new Set(boundaries.allowed.map(([from, to]) => `${from}\u0000${to}`));
  const layerOfNote = (id: string) => {
    const symbol = symbols.get(id);
    return symbol === undefined ? null : layerOf(boundaries, symbol.path);
  };
  return edges.filter((edge) => {
    const from = layerOfNote(edge.from);
    const to = layerOfNote(edge.to);
    return from !== null && to !== null && from !== to && !allowed.has(`${from}\u0000${to}`);
  });
}
