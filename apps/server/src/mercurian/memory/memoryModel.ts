import {
  ProductMapCycleError,
  type MemoryArrangementNode,
  type MemoryMap,
} from "@t3tools/contracts";
import { isAlias, parseDocument, stringify, visit } from "yaml";

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

export interface MemoryOpenDecision {
  readonly title: string;
  readonly resolved: boolean;
}

export function parseOpenDecisions(markdown: string): ReadonlyArray<MemoryOpenDecision> {
  const lines = stripMarkdownCode(markdown).split(/\r?\n/u);
  const sectionStart = lines.findIndex((line) => line.trimEnd() === "## Open Decisions");
  if (sectionStart < 0) return [];
  const sectionEnd = lines.findIndex((line, index) => index > sectionStart && /^##\s+/u.test(line));
  const section = lines.slice(sectionStart + 1, sectionEnd < 0 ? undefined : sectionEnd);
  const decisions: Array<MemoryOpenDecision> = [];
  for (let index = 0; index < section.length; index += 1) {
    const heading = /^###\s+(.+?)\s*$/u.exec(section[index] ?? "");
    if (heading === null) continue;
    const title = heading[1]!.trim();
    if (title.length === 0) continue;
    const nextHeading = section.findIndex(
      (line, candidate) => candidate > index && /^###\s+/u.test(line),
    );
    const subsection = section.slice(index + 1, nextHeading < 0 ? undefined : nextHeading);
    decisions.push({
      title,
      resolved: subsection.some((line) => /^\*\*Resolved/u.test(line)),
    });
  }
  return decisions;
}

export function missingOpenDecisionHeadings(before: string, after: string): ReadonlyArray<string> {
  const afterTitles = new Set(parseOpenDecisions(after).map(({ title }) => title));
  return parseOpenDecisions(before)
    .map(({ title }) => title)
    .filter((title) => !afterTitles.has(title));
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

function validateArrangement(
  file: string,
  value: unknown,
  location: string,
  seen: Set<string>,
): MemoryArrangementNode | { readonly file: string; readonly refusal: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return refuse(file, `${location} must be an object`);
  }
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== "note" && key !== "children") {
      return refuse(file, `unknown key "${key}" under ${location}`);
    }
  }
  if (typeof row.note !== "string") return refuse(file, `${location}.note must be a string`);
  const note = row.note;
  if (seen.has(note)) return refuse(file, `repeated note "${note}" at ${location}`);
  seen.add(note);
  if (row.children !== undefined && !Array.isArray(row.children)) {
    return refuse(file, `${location}.children must be a list`);
  }
  const children: Array<MemoryArrangementNode> = [];
  for (const [index, child] of (row.children ?? []).entries()) {
    const validated = validateArrangement(file, child, `${location}.children[${index}]`, seen);
    if ("refusal" in validated) return validated;
    children.push(validated);
  }
  return { note, ...(children.length === 0 ? {} : { children }) };
}

export function parseAndValidateMemoryMap(
  file: string,
  source: string,
  graph: MemoryGraph,
): MemoryMap | { readonly file: string; readonly refusal: string } {
  const document = parseDocument(source, { uniqueKeys: true });
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
  const allowed = new Set(["name", "purpose", "rule", "edge", "arrangement"]);
  for (const key of Object.keys(map)) {
    if (!allowed.has(key)) return refuse(file, `unknown top-level key "${key}"`);
  }
  for (const required of ["name", "purpose"] as const) {
    if (typeof map[required] !== "string") return refuse(file, `${required} must be a string`);
  }
  for (const optional of ["rule", "edge"] as const) {
    if (map[optional] !== undefined && typeof map[optional] !== "string") {
      return refuse(file, `${optional} must be a string`);
    }
  }
  if (!Array.isArray(map.arrangement)) return refuse(file, "arrangement must be a list");
  const seen = new Set<string>();
  const arrangement: Array<MemoryArrangementNode> = [];
  for (const [index, entry] of map.arrangement.entries()) {
    const validated = validateArrangement(file, entry, `arrangement[${index}]`, seen);
    if ("refusal" in validated) return validated;
    arrangement.push(validated);
  }

  const validateEdges = (
    nodes: ReadonlyArray<MemoryArrangementNode>,
  ): { readonly file: string; readonly refusal: string } | null => {
    for (const node of nodes) {
      for (const child of node.children ?? []) {
        const forward = graph.outgoing.get(node.note)?.includes(child.note) ?? false;
        const reverse = graph.outgoing.get(child.note)?.includes(node.note) ?? false;
        if (!forward && !reverse) {
          return refuse(
            file,
            `"${node.note}" does not link "${child.note}" — add the link to a note's prose or remove the placement`,
          );
        }
      }
      const nested = validateEdges(node.children ?? []);
      if (nested !== null) return nested;
    }
    return null;
  };
  const edgeRefusal = validateEdges(arrangement);
  if (edgeRefusal !== null) return edgeRefusal;

  return {
    file,
    name: map.name as string,
    purpose: map.purpose as string,
    ...(typeof map.rule === "string" ? { rule: map.rule } : {}),
    ...(typeof map.edge === "string" ? { edge: map.edge } : {}),
    arrangement,
  };
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
    // A map is an arrangement tree, so a multiply-contained note gets one
    // deterministic placement instead of producing invalid repeated nodes.
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

  const build = (note: string): MemoryArrangementNode => {
    const descendants = [...(children.get(note) ?? [])]
      .sort((a, b) => a.localeCompare(b))
      .map(build);
    return { note, ...(descendants.length === 0 ? {} : { children: descendants }) };
  };
  const roots = [...involved]
    .filter((name) => !contained.has(name))
    .sort((a, b) => a.localeCompare(b));
  return {
    file: "maps/product.yaml",
    name: "Product",
    purpose: "Generated from contains:: declarations in memory notes.",
    edge: "contains",
    arrangement: roots.map(build),
  };
}

export function serializeMemoryMap(map: MemoryMap): string {
  const { file: _file, ...document } = map;
  return stringify(document, { lineWidth: 0 });
}

export function insertMapPlacement(
  map: MemoryMap,
  parent: string,
  note: string,
  graph: MemoryGraph,
): MemoryMap | { readonly file: string; readonly refusal: string } {
  const contains = (nodes: ReadonlyArray<MemoryArrangementNode>, name: string): boolean =>
    nodes.some((node) => node.note === name || contains(node.children ?? [], name));
  if (!contains(map.arrangement, parent)) {
    return refuse(map.file, `parent "${parent}" is not present in the arrangement`);
  }
  if (contains(map.arrangement, note)) {
    return refuse(map.file, `note "${note}" is already present in the arrangement`);
  }
  const insert = (
    nodes: ReadonlyArray<MemoryArrangementNode>,
  ): ReadonlyArray<MemoryArrangementNode> =>
    nodes.map((node) =>
      node.note === parent
        ? { ...node, children: [...(node.children ?? []), { note }] }
        : { ...node, ...(node.children === undefined ? {} : { children: insert(node.children) }) },
    );
  const candidate = { ...map, arrangement: insert(map.arrangement) };
  return parseAndValidateMemoryMap(map.file, serializeMemoryMap(candidate), graph);
}

export function fingerprintMemoryFiles(entries: ReadonlyArray<MemoryFileFingerprintEntry>): string {
  return [...entries]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, mtimeMs, size }) => `${path}\0${mtimeMs}\0${size}`)
    .join("\n");
}
