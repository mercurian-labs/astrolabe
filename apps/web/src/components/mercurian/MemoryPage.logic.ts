import type { MemoryIndex, MemoryMap, MemoryMapRefusal } from "@t3tools/contracts";

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
