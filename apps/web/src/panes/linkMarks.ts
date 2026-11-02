import { allTabs } from "./arrangement";
import type { LinkedArrangement } from "./linkedTabs";
import { workspace } from "./workspace";

/**
 * Astrolabe: which file each following local graph shows now, as the graphs report it, so the
 * link marker can tie a graph to the file it follows. A pinned graph follows nothing.
 */
function createFollowedFiles() {
  const files = new Map<string, string>();
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    set(graphKey: string, fileKey: string | null) {
      if ((files.get(graphKey) ?? null) === fileKey) return;
      if (fileKey === null) files.delete(graphKey);
      else files.set(graphKey, fileKey);
      version += 1;
      for (const listener of listeners) listener();
    },
    /** The file a following graph's tab follows; null for any other tab. */
    fileOf: (graphKey: string) => files.get(graphKey) ?? null,
    entries: () => files.entries(),
    version: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const followedGraphFiles = createFollowedFiles();

interface Marks {
  readonly linked: LinkedArrangement;
  readonly version: number;
  /** By tab key: `l:<ink>` for a linked tab, `o:<ink>:<count>` for an owner. */
  readonly marks: ReadonlyMap<string, string>;
}

let cached: Marks | null = null;

/**
 * The marks on screen: each owner with linked tabs showing (a chat and its surfaces, a group and
 * its change requests, a file and the graph following it) takes the next ink in reading order,
 * and it and its linked tabs carry it.
 */
function marksNow(): Marks {
  const linked = workspace.linked();
  const version = followedGraphFiles.version();
  if (cached && cached.linked === linked && cached.version === version) return cached;
  const open = allTabs(linked.arrangement);
  const openSet = new Set(open);
  const ownerOf = new Map<string, string>();
  for (const key of open) {
    const owner = linked.owners[key] ?? followedGraphFiles.fileOf(key);
    if (owner !== null && owner !== undefined && owner !== key) ownerOf.set(key, owner);
  }
  const position = (key: string) => {
    const at = open.indexOf(key);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  const owners = [...new Set(ownerOf.values())].toSorted((a, b) => position(a) - position(b));
  const marks = new Map<string, string>();
  owners.forEach((owner, ink) => {
    const tabs = [...ownerOf].filter(([, by]) => by === owner);
    for (const [key] of tabs) marks.set(key, `l:${ink}`);
    if (openSet.has(owner)) marks.set(owner, `o:${ink}:${tabs.length}`);
  });
  cached = { linked, version, marks };
  return cached;
}

/** A tab's mark: whether it owns linked tabs (and how many) or is one, and its ink; else null. */
export function linkMarkOf(
  tabKey: string,
): { readonly owns: boolean; readonly ink: number; readonly count: number } | null {
  const mark = marksNow().marks.get(tabKey);
  if (mark === undefined) return null;
  const [kind, ink, count] = mark.split(":");
  return { owns: kind === "o", ink: Number(ink), count: Number(count ?? 0) };
}

/** A tab's mark as a string, stable between changes, for a component to subscribe to. */
export function linkMarkKeyOf(tabKey: string): string | null {
  return marksNow().marks.get(tabKey) ?? null;
}
