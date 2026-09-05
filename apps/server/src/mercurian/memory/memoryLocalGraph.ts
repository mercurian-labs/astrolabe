import type { MemoryDocumentKind, MemoryLocalGraph } from "@t3tools/contracts";
import { parseWikilinks } from "./memoryModel.ts";

export interface LocalGraphDocument {
  readonly id: string;
  readonly kind: MemoryDocumentKind;
  readonly before: { readonly name: string; readonly markdown: string } | null;
  readonly after: { readonly name: string; readonly markdown: string } | null;
  readonly name: string;
}

/** Only real prose links between changed identities; isolates are explicit. */
export function memoryLocalGraph(documents: ReadonlyArray<LocalGraphDocument>): MemoryLocalGraph {
  const notes = documents
    .filter((d) => d.kind === "note")
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const outsideReferences: Array<MemoryLocalGraph["outsideReferences"][number]> = [];
  const edges = (side: "before" | "after") => {
    const byName = new Map<string, string[]>();
    for (const note of notes) {
      const version = note[side];
      if (version) byName.set(version.name, [...(byName.get(version.name) ?? []), note.id]);
    }
    const result = new Map<string, { from: string; to: string }>();
    for (const note of notes) {
      const version = note[side];
      if (!version) continue;
      for (const name of parseWikilinks(version.markdown)) {
        const targets = byName.get(name);
        if (targets?.length === 1) {
          const to = targets[0]!;
          result.set(JSON.stringify([note.id, to]), { from: note.id, to });
        } else
          outsideReferences.push({
            from: note.id,
            name,
            side: side === "before" ? "baseline" : "selected",
          });
      }
    }
    return result;
  };
  const before = edges("before");
  const after = edges("after");
  return {
    nodes: notes.map((n) => ({ id: n.id, name: n.name })),
    edges: [...new Set([...before.keys(), ...after.keys()])].sort().map((key) => ({
      ...(after.get(key) ?? before.get(key))!,
      status: before.has(key) ? (after.has(key) ? "unchanged" : "removed") : "added",
    })),
    outsideReferences,
  };
}

/** M-214 can supply exact repository-relative document paths here when it lands. */
export function classifyMemoryDocument(
  path: string,
  memoryRoot: string,
  documentPaths: ReadonlySet<string> = new Set(),
): MemoryDocumentKind | null {
  if (documentPaths.has(path)) return "document";
  const relative = memoryRoot
    ? path.startsWith(`${memoryRoot}/`)
      ? path.slice(memoryRoot.length + 1)
      : ""
    : path;
  if (!relative || relative.split("/").some((part) => part.startsWith("."))) return null;
  if (relative.endsWith(".skillmap.md") || /^maps\/[^/]+\.yaml$/u.test(relative))
    return "skill-map";
  if (relative.startsWith("maps/")) return null;
  return relative.endsWith(".md") ? "note" : null;
}
