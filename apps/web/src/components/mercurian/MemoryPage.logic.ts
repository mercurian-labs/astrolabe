import type { MemoryIndex, MemoryMap, MemoryMapRefusal } from "@t3tools/contracts";

export interface SkillMapTreeNode {
  readonly key: string;
  readonly name: string;
  readonly edgeType?: string;
  readonly children: ReadonlyArray<SkillMapTreeNode>;
}

export function skillMapIsForest(map: MemoryMap): boolean {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, Array<string>>();
  const nodes = new Set<string>();
  for (const edge of map.edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    if ((incoming.get(edge.to) ?? 0) > 1) return false;
    const children = outgoing.get(edge.from) ?? [];
    children.push(edge.to);
    outgoing.set(edge.from, children);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): boolean => {
    if (visiting.has(name)) return false;
    if (visited.has(name)) return true;
    visiting.add(name);
    for (const child of outgoing.get(name) ?? []) {
      if (!visit(child)) return false;
    }
    visiting.delete(name);
    visited.add(name);
    return true;
  };
  return [...nodes].every(visit);
}

export function skillMapView(map: MemoryMap): "tree" | "graph" {
  return map.view ?? (skillMapIsForest(map) ? "tree" : "graph");
}

export function buildSkillMapTree(map: MemoryMap): ReadonlyArray<SkillMapTreeNode> {
  const children = new Map<
    string,
    Array<{ readonly name: string; readonly edgeType: string; readonly edgeIndex: number }>
  >();
  const targets = new Set(map.edges.map(({ to }) => to));
  const appearances: Array<string> = [];
  const appeared = new Set<string>();
  for (const [edgeIndex, edge] of map.edges.entries()) {
    for (const name of [edge.from, edge.to]) {
      if (appeared.has(name)) continue;
      appeared.add(name);
      appearances.push(name);
    }
    const entries = children.get(edge.from) ?? [];
    entries.push({ name: edge.to, edgeType: edge.type, edgeIndex });
    children.set(edge.from, entries);
  }
  const roots = appearances.filter((name) => !targets.has(name));
  if (roots.length === 0 && appearances[0] !== undefined) roots.push(appearances[0]);
  const build = (
    name: string,
    edgeType: string | undefined,
    key: string,
    ancestors: ReadonlySet<string>,
  ): SkillMapTreeNode => {
    if (ancestors.has(name)) return { key, name, ...(edgeType ? { edgeType } : {}), children: [] };
    const nextAncestors = new Set(ancestors).add(name);
    return {
      key,
      name,
      ...(edgeType ? { edgeType } : {}),
      children: (children.get(name) ?? []).map((child) =>
        build(
          child.name,
          child.edgeType,
          `${key}/edge:${child.edgeIndex}:${child.name}`,
          nextAncestors,
        ),
      ),
    };
  };
  return roots.map((root) => build(root, undefined, `root:${root}`, new Set()));
}

export function memoryMapTeachingLinks(
  map: MemoryMap,
  index: Pick<MemoryIndex, "notes">,
): ReadonlyArray<{ readonly name: string; readonly exists: boolean }> {
  const written = new Set(index.notes.map(({ name }) => name.toLocaleLowerCase()));
  const selected = new Map<string, string>();
  for (const match of map.body.matchAll(/\[\[([^[\]\n|]+?)(?:\|[^[\]\n|]+?)?\]\]/gu)) {
    const name = (match[1] ?? "").trim();
    if (name.length > 0 && !selected.has(name.toLocaleLowerCase())) {
      selected.set(name.toLocaleLowerCase(), name);
    }
  }
  return [...selected.entries()].map(([normalized, name]) => ({
    name,
    exists: written.has(normalized),
  }));
}

export type MemoryRailItem =
  | { readonly kind: "map"; readonly key: string; readonly map: MemoryMap }
  | { readonly kind: "refused-map"; readonly key: string; readonly map: MemoryMapRefusal }
  | { readonly kind: "note"; readonly key: string; readonly name: string }
  | {
      readonly kind: "unresolved";
      readonly key: string;
      readonly name: string;
      readonly referencedBy: ReadonlyArray<string>;
    };

export function memoryRailItems(index: MemoryIndex): ReadonlyArray<MemoryRailItem> {
  const byLabel = (left: { label: string }, right: { label: string }) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  const maps = index.maps
    .map((map) =>
      "refusal" in map
        ? { kind: "refused-map" as const, key: `map:${map.file}`, map, label: map.file }
        : { kind: "map" as const, key: `map:${map.file}`, map, label: map.name },
    )
    .toSorted(byLabel)
    .map(({ label: _label, ...item }) => item);
  const notes = index.notes
    .map(({ name }) => ({ kind: "note" as const, key: `note:${name}`, name, label: name }))
    .toSorted(byLabel)
    .map(({ label: _label, ...item }) => item);
  const unresolved = index.unresolved
    .map(({ name, referencedBy }) => ({
      kind: "unresolved" as const,
      key: `unresolved:${name}`,
      name,
      referencedBy,
      label: name,
    }))
    .toSorted(byLabel)
    .map(({ label: _label, ...item }) => item);
  return [...maps, ...notes, ...unresolved];
}

export function initialMemorySelection(
  items: ReadonlyArray<MemoryRailItem>,
  noteSearch: string | undefined,
): string | null {
  if (noteSearch) {
    const named = items.find(
      (item) =>
        (item.kind === "note" || item.kind === "unresolved") &&
        item.name.toLocaleLowerCase() === noteSearch.toLocaleLowerCase(),
    );
    if (named !== undefined) return named.key;
    return `unresolved:${noteSearch}`;
  }
  return items.find((item) => item.kind !== "refused-map")?.key ?? items[0]?.key ?? null;
}

export type MemoryPageStanding = "no-project" | "not-designated" | "loading" | "ready";

export function memoryPageStanding(input: {
  readonly projectId: string | null;
  readonly designated: boolean;
  readonly index: MemoryIndex | null;
}): MemoryPageStanding {
  if (input.projectId === null) return "no-project";
  if (!input.designated) return "not-designated";
  return input.index === null ? "loading" : "ready";
}

/** The frontier's write door: a message that starts the amendment flow, never an editor. */
export function writeNoteSeedMessage(name: string, referencedBy: ReadonlyArray<string>): string {
  const spoken =
    referencedBy.length <= 1
      ? referencedBy.join("")
      : `${referencedBy.slice(0, -1).join(", ")} and ${referencedBy.at(-1)}`;
  const references = spoken.length === 0 ? "" : ` — it's referenced by ${spoken}`;
  return `Write [[${name}]]${references}. Propose it as a memory amendment.`;
}
