import { Document, parseDocument } from "yaml";

export interface MapEdgeRef {
  readonly from: string;
  readonly type: string;
  readonly to: string;
}

export interface MapEdge extends MapEdgeRef {
  readonly rationale: string;
}

export interface MapWarningResolution {
  readonly at: string;
  readonly amendment: string;
  readonly text: string;
}

/** An append-only record that an amendment severed the prose link a map edge stood on. */
export interface MapWarning {
  readonly id: string;
  readonly amendment: string;
  readonly at: string;
  readonly edge: MapEdgeRef;
  readonly resolution?: MapWarningResolution;
}

export interface SkillMap {
  readonly version: 1;
  readonly name: string;
  readonly purpose: string;
  readonly types: Readonly<Record<string, string>>;
  readonly edges: ReadonlyArray<MapEdge>;
  readonly view?: "tree" | "flow" | "web";
  readonly warnings?: ReadonlyArray<MapWarning>;
  readonly body?: string;
}

export class WikiFormatError extends Error {
  override readonly name = "WikiFormatError";
}

export const isMapFile = (file: string): boolean => file.endsWith(".skillmap.md");

export const sameEdge = (a: MapEdgeRef, b: MapEdgeRef): boolean =>
  a.from.normalize("NFC").toLowerCase() === b.from.normalize("NFC").toLowerCase() &&
  a.to.normalize("NFC").toLowerCase() === b.to.normalize("NFC").toLowerCase() &&
  a.type === b.type;

type Unknown = Record<string, unknown>;

function object(value: unknown, label: string): asserts value is Unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WikiFormatError(`${label} must be an object`);
  }
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WikiFormatError(`${label} must be nonempty text`);
  }
}
function fields(
  value: unknown,
  allowed: ReadonlyArray<string>,
  label: string,
): asserts value is Unknown {
  object(value, label);
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) throw new WikiFormatError(`${label}: unknown field ${field}`);
  }
}

/** Validates the structure only; a map's genre is teaching, never parsed. */
export function checkMap(value: unknown): SkillMap {
  fields(
    value,
    ["version", "name", "purpose", "types", "edges", "view", "warnings", "body"],
    "map",
  );
  if (value.version !== 1) throw new WikiFormatError("Unsupported skill-map version (expected 1)");
  text(value.name, "name");
  text(value.purpose, "purpose");
  const types = value.types;
  object(types, "types");
  if (!Object.keys(types).length) throw new WikiFormatError("Declare at least one edge type");
  for (const [name, meaning] of Object.entries(types)) {
    text(name, "type");
    text(meaning, `types.${name}`);
  }
  if (!Array.isArray(value.edges)) throw new WikiFormatError("edges must be a list");
  for (const edge of value.edges as unknown[]) {
    fields(edge, ["from", "type", "to", "rationale"], "edge");
    for (const field of ["from", "type", "to", "rationale"]) text(edge[field], `edge.${field}`);
    if (!Object.hasOwn(types, edge.type as string)) {
      throw new WikiFormatError(`Undeclared edge type: ${String(edge.type)}`);
    }
  }
  if (value.view !== undefined && !["tree", "flow", "web"].includes(value.view as string)) {
    throw new WikiFormatError("view must be tree, flow, or web");
  }
  if (value.body !== undefined && typeof value.body !== "string") {
    throw new WikiFormatError("body must be text");
  }
  const warnings = value.warnings ?? [];
  if (!Array.isArray(warnings)) throw new WikiFormatError("warnings must be a list");
  const ids = new Set<string>();
  for (const warning of warnings as unknown[]) {
    fields(warning, ["id", "amendment", "at", "edge", "resolution"], "warning");
    for (const field of ["id", "amendment", "at"]) text(warning[field], `warning.${field}`);
    if (ids.has(warning.id as string)) throw new WikiFormatError("Duplicate warning id");
    ids.add(warning.id as string);
    fields(warning.edge, ["from", "to", "type"], "warning.edge");
    for (const field of ["from", "to", "type"]) {
      text((warning.edge as Unknown)[field], `warning.edge.${field}`);
    }
    if (warning.resolution !== undefined) {
      fields(warning.resolution, ["at", "amendment", "text"], "resolution");
      for (const field of ["at", "amendment", "text"]) {
        text((warning.resolution as Unknown)[field], `resolution.${field}`);
      }
    }
  }
  return value as unknown as SkillMap;
}

export function parseMap(source: string): SkillMap {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new WikiFormatError("Missing skill-map frontmatter");
  const document = parseDocument(match[1] ?? "", { uniqueKeys: true, schema: "core" });
  const firstError = document.errors[0];
  if (firstError) throw new WikiFormatError(firstError.message);
  const data: unknown = document.toJS({ maxAliasCount: 0 });
  object(data, "map");
  return checkMap({ ...data, body: source.slice(match[0].length).trim() });
}

/** Writes a map back in the vault's own layout: block YAML with one flow mapping per edge. */
export function serializeMap(map: SkillMap): string {
  checkMap(map);
  const { body = "", ...data } = map;
  const doc = new Document(data);
  const edges = doc.get("edges", true) as { items?: Array<{ flow?: boolean }> } | undefined;
  for (const item of edges?.items ?? []) item.flow = true;
  return `---\n${doc.toString({ lineWidth: 0 })}---\n\n${body.trim()}\n`;
}
