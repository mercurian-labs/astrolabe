import { ProductMapCycleError, type MemoryMap, type MemoryMapEdge } from "@t3tools/contracts";
import { Document, isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";

export interface MemoryNoteFile {
  readonly name: string;
  readonly path: string;
  readonly markdown: string;
}

export interface MemoryGraph {
  readonly notes: ReadonlyArray<MemoryNoteFile>;
  readonly noteByName: ReadonlyMap<string, MemoryNoteFile>;
  readonly outgoing: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly backlinks: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly unresolved: ReadonlyArray<{
    readonly name: string;
    readonly referencedBy: ReadonlyArray<string>;
  }>;
  readonly declarations: ReadonlyArray<{ readonly parent: string; readonly child: string }>;
  readonly problems: ReadonlyArray<string>;
}

export interface MemoryFileFingerprintEntry {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/** Markdown code is not prose and therefore cannot declare a memory edge. */
export function stripMarkdownCode(markdown: string): string {
  return markdown
    .replace(/^\s*(```+|~~~+)[^\n]*\n[\s\S]*?^\s*\1\s*$/gmu, "")
    .replace(/(`+)[^\n]*?\1/gu, "");
}

export function parseWikilinks(markdown: string): ReadonlyArray<string> {
  const links: Array<string> = [];
  const prose = stripMarkdownCode(markdown);
  for (const match of prose.matchAll(/\[\[([^\[\]\n|]+?)(?:\|[^\[\]\n|]+?)?\]\]/gu)) {
    const name = (match[1] ?? "").trim();
    if (name && !links.includes(name)) links.push(name);
  }
  return links;
}

export function parseContainsLines(
  noteName: string,
  markdown: string,
): ReadonlyArray<{ readonly parent: string; readonly child: string }> {
  const declarations: Array<{ parent: string; child: string }> = [];
  for (const line of stripMarkdownCode(markdown).split(/\r?\n/u)) {
    if (!line.startsWith("contains::")) continue;
    for (const child of parseWikilinks(line.slice("contains::".length))) {
      declarations.push({ parent: noteName, child });
    }
  }
  return declarations;
}

export function isValidMemoryNoteName(name: string): boolean {
  return (
    name.trim().length > 0 &&
    name === name.trim() &&
    !name.startsWith(".") &&
    !name.toLowerCase().endsWith(".md") &&
    !/[\\/]/u.test(name)
  );
}

export function buildMemoryGraph(files: ReadonlyArray<MemoryNoteFile>): MemoryGraph {
  const selected = new Map<string, MemoryNoteFile>();
  const problems: Array<string> = [];
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const previous = selected.get(file.name);
    if (previous === undefined) {
      selected.set(file.name, file);
    } else {
      problems.push(
        `Note name collision "${file.name}": indexed ${previous.path}; ignored ${file.path}`,
      );
    }
  }
  const notes = [...selected.values()].sort((left, right) => left.name.localeCompare(right.name));
  const outgoing = new Map<string, ReadonlyArray<string>>();
  const backlinksMutable = new Map<string, Set<string>>();
  const declarations: Array<{ parent: string; child: string }> = [];
  for (const note of notes) {
    const links = [...parseWikilinks(note.markdown)].sort((a, b) => a.localeCompare(b));
    outgoing.set(note.name, links);
    for (const link of links) {
      const references = backlinksMutable.get(link) ?? new Set<string>();
      references.add(note.name);
      backlinksMutable.set(link, references);
    }
    declarations.push(...parseContainsLines(note.name, note.markdown));
  }
  const backlinks = new Map(
    [...backlinksMutable.entries()].map(([name, references]) => [
      name,
      [...references].sort((a, b) => a.localeCompare(b)),
    ]),
  );
  const unresolved = [...backlinks.entries()]
    .filter(([name]) => !selected.has(name))
    .map(([name, referencedBy]) => ({ name, referencedBy }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    notes,
    noteByName: selected,
    outgoing,
    backlinks,
    unresolved,
    declarations: declarations.sort(
      (left, right) =>
        left.parent.localeCompare(right.parent) || left.child.localeCompare(right.child),
    ),
    problems,
  };
}

const refuse = (file: string, problem: string) => ({ file, refusal: `${file}: ${problem}` });

function findYamlFeature(document: ReturnType<typeof parseDocument>): string | null {
  let problem: string | null = null;
  visit(document, {
    Node(_key, node) {
      if (problem !== null) return visit.BREAK;
      if (isAlias(node)) {
        problem = "YAML aliases are not allowed";
        return visit.BREAK;
      }
      if (node.anchor) {
        problem = "YAML anchors are not allowed";
        return visit.BREAK;
      }
      if (node.tag) {
        problem = "YAML tags are not allowed";
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return problem;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export function parseSkillMap(
  file: string,
  source: string,
  graph: MemoryGraph,
): MemoryMap | { readonly file: string; readonly refusal: string } {
  const frontmatter = FRONTMATTER_PATTERN.exec(source);
  if (frontmatter === null) return refuse(file, "missing frontmatter");
  const document = parseDocument(frontmatter[1] ?? "", { uniqueKeys: true });
  if (document.errors.length > 0) {
    return refuse(file, `malformed YAML: ${document.errors[0]?.message ?? "parse error"}`);
  }
  const yamlFeature = findYamlFeature(document);
  if (yamlFeature !== null) return refuse(file, yamlFeature);

  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return refuse(file, "top level must be an object");
  }
  const map = value as Record<string, unknown>;
  const allowed = new Set(["name", "purpose", "types", "edges", "view"]);
  for (const key of Object.keys(map)) {
    if (!allowed.has(key)) return refuse(file, `unknown top-level key "${key}"`);
  }
  for (const required of ["name", "purpose"] as const) {
    if (typeof map[required] !== "string") return refuse(file, `${required} must be a string`);
  }
  if (typeof map.types !== "object" || map.types === null || Array.isArray(map.types)) {
    return refuse(file, "types must be a non-empty mapping of edge type names to meanings");
  }
  const typesNode = document.get("types", true);
  if (!isMap(typesNode)) {
    return refuse(file, "types must be a non-empty mapping of edge type names to meanings");
  }
  for (const pair of typesNode.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
      return refuse(file, "type names under types must be strings");
    }
  }
  const typeEntries = Object.entries(map.types);
  if (typeEntries.length === 0) {
    return refuse(file, "types must be a non-empty mapping of edge type names to meanings");
  }
  const types: Array<{ readonly name: string; readonly meaning: string }> = [];
  for (const [name, meaning] of typeEntries) {
    if (typeof meaning !== "string") {
      return refuse(file, `types.${name} must be a string`);
    }
    types.push({ name, meaning });
  }
  if (!Array.isArray(map.edges)) return refuse(file, "edges must be a list");
  const declaredTypes = new Set(types.map(({ name }) => name));
  const edges: Array<MemoryMapEdge> = [];
  for (const [index, value] of map.edges.entries()) {
    const location = `edges[${index}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return refuse(file, `${location} must be an object`);
    }
    const edge = value as Record<string, unknown>;
    for (const key of Object.keys(edge)) {
      if (key !== "from" && key !== "type" && key !== "to") {
        return refuse(file, `unknown key "${key}" under ${location}`);
      }
    }
    for (const key of ["from", "type", "to"] as const) {
      if (typeof edge[key] !== "string") {
        return refuse(file, `${location}.${key} must be a string`);
      }
    }
    if (!declaredTypes.has(edge.type as string)) {
      return refuse(
        file,
        `${location}: type "${edge.type as string}" is not declared under types — declare it with a meaning or fix the edge`,
      );
    }
    edges.push({
      from: edge.from as string,
      type: edge.type as string,
      to: edge.to as string,
    });
  }
  if (map.view !== undefined && map.view !== "tree" && map.view !== "flow" && map.view !== "web") {
    return refuse(file, 'view must be "tree", "flow" or "web"');
  }
  for (const edge of edges) {
    const forward = graph.outgoing.get(edge.from)?.includes(edge.to) ?? false;
    const reverse = graph.outgoing.get(edge.to)?.includes(edge.from) ?? false;
    if (!forward && !reverse) {
      return refuse(
        file,
        `"${edge.from}" does not link "${edge.to}" — add the link to a note's prose or remove the edge`,
      );
    }
  }

  return {
    file,
    name: map.name as string,
    purpose: map.purpose as string,
    types,
    edges,
    ...(map.view === "tree" || map.view === "flow" || map.view === "web" ? { view: map.view } : {}),
    body: source.slice(frontmatter[0].length),
  };
}

export function legacyMemoryMapRefusal(file: string) {
  return refuse(file, "superseded tree-YAML map — rewrite it as a .skillmap.md skill map");
}

export function compileProductMap(
  declarations: ReadonlyArray<{ readonly parent: string; readonly child: string }>,
): MemoryMap | ProductMapCycleError {
  const children = new Map<string, Set<string>>();
  const allChildren = new Map<string, Set<string>>();
  const involved = new Set<string>();
  const contained = new Set<string>();
  const parentByChild = new Map<string, string>();
  for (const { parent, child } of [...declarations].sort(
    (left, right) =>
      left.child.localeCompare(right.child) || left.parent.localeCompare(right.parent),
  )) {
    involved.add(parent);
    involved.add(child);
    contained.add(child);
    const everyPlacement = allChildren.get(parent) ?? new Set<string>();
    everyPlacement.add(child);
    allChildren.set(parent, everyPlacement);
    // The generated product view stays a forest, so a multiply-contained note
    // gets one deterministic placement even though hand-authored maps may repeat it.
    if (parentByChild.has(child)) continue;
    parentByChild.set(child, parent);
    const set = children.get(parent) ?? new Set<string>();
    set.add(child);
    children.set(parent, set);
  }

  const visiting: Array<string> = [];
  const visited = new Set<string>();
  const detect = (name: string): ProductMapCycleError | null => {
    const position = visiting.indexOf(name);
    if (position >= 0) {
      return new ProductMapCycleError({ cycle: [...visiting.slice(position), name] });
    }
    if (visited.has(name)) return null;
    visiting.push(name);
    for (const child of [...(allChildren.get(name) ?? [])].sort((a, b) => a.localeCompare(b))) {
      const cycle = detect(child);
      if (cycle !== null) return cycle;
    }
    visiting.pop();
    visited.add(name);
    return null;
  };
  for (const name of [...involved].sort((a, b) => a.localeCompare(b))) {
    const cycle = detect(name);
    if (cycle !== null) return cycle;
  }

  const roots = [...involved]
    .filter((name) => !contained.has(name))
    .sort((a, b) => a.localeCompare(b));
  const edges: Array<MemoryMapEdge> = [];
  const append = (parent: string) => {
    for (const child of [...(children.get(parent) ?? [])].sort((a, b) => a.localeCompare(b))) {
      edges.push({ from: parent, type: "contains", to: child });
      append(child);
    }
  };
  for (const root of roots) append(root);
  return {
    file: "Product.skillmap.md",
    name: "Product",
    purpose: "Generated from contains:: declarations in memory notes.",
    types: [{ name: "contains", meaning: "The child is part of the parent's territory." }],
    edges,
    body: "Use this map to orient by containment: start with a broad area, then follow its contains edges toward the part you need.\n",
  };
}

export function serializeSkillMap(map: MemoryMap): string {
  const document = new Document({
    name: map.name,
    purpose: map.purpose,
    types: Object.fromEntries(map.types.map(({ name, meaning }) => [name, meaning])),
    edges: map.edges,
    ...(map.view === undefined ? {} : { view: map.view }),
  });
  const edgeSequence = document.get("edges", true);
  if (isSeq(edgeSequence)) {
    for (const edge of edgeSequence.items) {
      if (isMap(edge)) edge.flow = true;
    }
  }
  return `---\n${document.toString({ lineWidth: 0 })}---\n${map.body}`;
}

export function insertMapPlacement(
  map: MemoryMap,
  parent: string,
  note: string,
  graph: MemoryGraph,
  requestedType?: string,
): MemoryMap | { readonly file: string; readonly refusal: string } {
  const type = requestedType ?? (map.types.length === 1 ? map.types[0]!.name : null);
  if (type === null) {
    return refuse(
      map.file,
      `name the edge type — this map declares ${map.types.map(({ name }) => name).join(", ")}`,
    );
  }
  if (map.edges.some((edge) => edge.from === parent && edge.type === type && edge.to === note)) {
    return refuse(map.file, `edge "${parent}" --${type}--> "${note}" already exists`);
  }
  const candidate = { ...map, edges: [...map.edges, { from: parent, type, to: note }] };
  return parseSkillMap(map.file, serializeSkillMap(candidate), graph);
}

export function fingerprintMemoryFiles(entries: ReadonlyArray<MemoryFileFingerprintEntry>): string {
  return [...entries]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, mtimeMs, size }) => `${path}\0${mtimeMs}\0${size}`)
    .join("\n");
}
