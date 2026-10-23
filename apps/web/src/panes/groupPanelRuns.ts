import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { changeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import { pullRequestTargetOfKey } from "~/components/pullRequest/pullRequestTabs";
import { parseWikiTabKey, wikiTabKey } from "~/components/wiki/wikiTabs";
import { pullRequestSurfaceId } from "~/rightPanelStore";
import { allTabs, closeTab, surfaceIdOf, surfaceKey, type Arrangement } from "./arrangement";
import { findLeaf, leafWithTab, leaves, mapLeaf } from "./tree";

/**
 * Astrolabe: a change group's shared run in its threads' right panels. Beside every thread in a
 * group, the group's tabs other than chats (its own tab, its pull requests, its wiki change
 * requests) are one run the group owns: opened or closed beside one of its threads, they open or
 * close beside all of them. Which are open is the group's, kept here on the device; where they
 * stand, and which tab is in front, stay each thread's own. A thread's panel catches up with its
 * groups' runs as it shows and while it is on screen (`reconcilePanelRuns`), quietly: a closed
 * panel stays closed, and the tab in front stays in front.
 */

/** A pull request as a thread's right panel names it, its server being the thread's. */
export interface RunPullRequest {
  readonly projectId: string;
  readonly host?: string;
  readonly repository: string;
  readonly number: number;
}

/** One tab of a group's run: the group's own tab, a wiki change request, or a pull request. */
export type RunEntry =
  | { readonly kind: "group" }
  | { readonly kind: "wiki-change-request"; readonly key: string }
  | ({ readonly kind: "pull-request" } & RunPullRequest);

export interface GroupRun {
  /** Its tabs open beside its threads, in the run's order. */
  readonly open: readonly RunEntry[];
  /** Entries (`runEntryId`) closed beside one of its threads, which the others close too. */
  readonly closed: readonly string[];
}

/** By the group's own tab key (`changeGroupTabKey`). */
export type GroupPanelRuns = Readonly<Record<string, GroupRun>>;

const EMPTY_RUN: GroupRun = { open: [], closed: [] };

const pullRequestRunId = (repository: string, number: number | string) =>
  `pull-request:${repository}#${number}`;

/**
 * What names an entry in its run: the group's or the wiki change request's tab key, or a pull
 * request's repository and number, whichever project and host a thread's panel names it by.
 */
function runEntryId(groupKey: string, entry: RunEntry): string {
  switch (entry.kind) {
    case "group":
      return groupKey;
    case "wiki-change-request":
      return entry.key;
    case "pull-request":
      return pullRequestRunId(entry.repository, entry.number);
  }
}

/** The tab an entry is beside a thread. */
function runEntryTabKey(groupKey: string, entry: RunEntry): string {
  if (entry.kind !== "pull-request") return runEntryId(groupKey, entry);
  const { kind: _kind, ...pullRequest } = entry;
  return surfaceKey(pullRequestSurfaceId(pullRequest));
}

/**
 * The entry a tab key names on its own, as a group's tab opens its tabs together: its own tab, a
 * wiki change request, or a pull request named in full. Null for any other key.
 */
export function runEntryOfKey(groupKey: string, key: string): RunEntry | null {
  if (key === groupKey) return { kind: "group" };
  if (parseWikiTabKey(key)?.kind === "change-request") return { kind: "wiki-change-request", key };
  const target = pullRequestTargetOfKey(key);
  if (target === null) return null;
  const { projectId, host, repository, number } = target;
  return { kind: "pull-request", projectId, host, repository, number };
}

/**
 * The runs with `entries` open in `groupKey`'s, after those open already, and no longer closed.
 * The same object when nothing changed.
 */
export function openRunEntries(
  runs: GroupPanelRuns,
  groupKey: string,
  entries: readonly RunEntry[],
): GroupPanelRuns {
  const run = runs[groupKey] ?? EMPTY_RUN;
  const ids = new Set(run.open.map((entry) => runEntryId(groupKey, entry)));
  const opening = new Set<string>();
  const added: RunEntry[] = [];
  for (const entry of entries) {
    const id = runEntryId(groupKey, entry);
    opening.add(id);
    if (ids.has(id)) continue;
    ids.add(id);
    added.push(entry);
  }
  const closed = run.closed.filter((id) => !opening.has(id));
  if (added.length === 0 && closed.length === run.closed.length) return runs;
  return { ...runs, [groupKey]: { open: [...run.open, ...added], closed } };
}

/**
 * The runs with the entries `ids` closed in `groupKey`'s: no longer open, and remembered closed,
 * so its other threads close them too. The same object when nothing changed.
 */
export function closeRunEntries(
  runs: GroupPanelRuns,
  groupKey: string,
  ids: readonly string[],
): GroupPanelRuns {
  if (ids.length === 0) return runs;
  const run = runs[groupKey] ?? EMPTY_RUN;
  const closing = new Set(ids);
  const open = run.open.filter((entry) => !closing.has(runEntryId(groupKey, entry)));
  const closed = [...run.closed, ...[...closing].filter((id) => !run.closed.includes(id))];
  if (open.length === run.open.length && closed.length === run.closed.length) return runs;
  return { ...runs, [groupKey]: { open, closed } };
}

/** A group a thread works in, as its panel's run needs it. */
export interface RunGroup {
  /** The group's own tab key, which names its run. */
  readonly key: string;
  /** The entries its members make (`runEntryId`), its own tab's among them. */
  readonly entryIds: ReadonlySet<string>;
}

export function runGroupOf(group: EnvironmentChangeGroup): RunGroup {
  const key = changeGroupTabKey(group);
  const entryIds = new Set([key]);
  for (const { ref } of group.members) {
    if (ref.kind === "pull-request") entryIds.add(pullRequestRunId(ref.repository, ref.number));
    if (ref.kind === "wiki-change-request") {
      entryIds.add(
        wikiTabKey({
          kind: "change-request",
          environmentId: group.environmentId,
          wikiId: ref.wikiId,
          changeRequestId: ref.changeRequestId,
        }),
      );
    }
  }
  return { key, entryIds };
}

export function isGroupThread(group: EnvironmentChangeGroup, thread: ScopedThreadRef): boolean {
  return group.environmentId === thread.environmentId && group.threadIds.includes(thread.threadId);
}

/** The groups a thread works in, as its panel's runs need them. */
export function threadRunGroups(
  groups: ReadonlyArray<EnvironmentChangeGroup>,
  thread: ScopedThreadRef,
): RunGroup[] {
  return groups.filter((group) => isGroupThread(group, thread)).map(runGroupOf);
}

/**
 * The entry a tab beside a thread stands for: its key, or a pull request's repository and number
 * (`runEntryId`). Null for the thread's other surfaces.
 */
function tabRunId(key: string): string | null {
  const surfaceId = surfaceIdOf(key);
  if (surfaceId === null) return key;
  if (!surfaceId.startsWith("pull-request:")) return null;
  const parts = surfaceId.split(":");
  try {
    return pullRequestRunId(decodeURIComponent(parts.at(-2) ?? ""), parts.at(-1) ?? "");
  } catch {
    return null;
  }
}

/** The group's tabs a panel holds, by entry, in reading order. */
function heldRunTabs(arrangement: Arrangement, group: RunGroup): Map<string, string> {
  const held = new Map<string, string>();
  for (const key of allTabs(arrangement)) {
    const id = tabRunId(key);
    if (id !== null && group.entryIds.has(id) && !held.has(id)) held.set(id, key);
  }
  return held;
}

/** The entries of `group` a panel holds (`runEntryId`), in reading order. */
export function heldRunIds(arrangement: Arrangement, group: RunGroup): string[] {
  return [...heldRunTabs(arrangement, group).keys()];
}

/**
 * Opens the tabs of `missing` among a run's tabs (`ordered`, the run's order) where the run
 * stands: in the pane holding part of it, else the pane holding the thread's surfaces, else the
 * focused pane. Each goes after the run's tab before it there, else before the one after it, else
 * at the pane's end. No tab comes to the front, and focus stays where it is.
 */
export function placeRunTabs(
  arrangement: Arrangement,
  ordered: readonly string[],
  missing: ReadonlySet<string>,
): Arrangement {
  if (missing.size === 0) return arrangement;
  const panes = leaves(arrangement.root);
  const pane =
    panes.find((leaf) => leaf.tabs.some((key) => ordered.includes(key) && !missing.has(key))) ??
    panes.find((leaf) => leaf.tabs.some((key) => surfaceIdOf(key) !== null)) ??
    findLeaf(arrangement.root, arrangement.focused) ??
    panes[0];
  if (!pane) return arrangement;
  let next = arrangement;
  ordered.forEach((key, index) => {
    if (!missing.has(key) || leafWithTab(next.root, key)) return;
    const tabs = findLeaf(next.root, pane.id)?.tabs ?? [];
    const before = ordered.slice(0, index).findLast((other) => tabs.includes(other));
    const after = ordered.slice(index + 1).find((other) => tabs.includes(other));
    const at =
      before !== undefined
        ? tabs.indexOf(before) + 1
        : after !== undefined
          ? tabs.indexOf(after)
          : tabs.length;
    next = {
      ...next,
      root: mapLeaf(next.root, pane.id, (leaf) => ({
        ...leaf,
        tabs: [...leaf.tabs.slice(0, at), key, ...leaf.tabs.slice(at)],
      })),
    };
  });
  return next;
}

/** By group key, the entries a panel held when it last caught up with its groups' runs. */
export type SeenRuns = Readonly<Record<string, readonly string[]>>;

export interface PanelRunsInput {
  readonly arrangement: Arrangement;
  /** The thread's pull requests in its right-panel record, by surface id. */
  readonly pullRequests: ReadonlyMap<string, RunPullRequest>;
  /** The groups the thread works in. */
  readonly groups: readonly RunGroup[];
  readonly runs: GroupPanelRuns;
  /**
   * What the panel held when it last caught up (the last call's `seen`). A group missing here
   * has not been caught up with since the thread showed.
   */
  readonly seen: SeenRuns;
}

export interface PanelRunsChange {
  readonly arrangement: Arrangement;
  readonly runs: GroupPanelRuns;
  /** Pull requests for the thread's record, added quietly: their tabs are in place already. */
  readonly addPullRequests: readonly RunPullRequest[];
  /** Surfaces for the thread's record to drop quietly: their tabs are closed already. */
  readonly removeSurfaceIds: readonly string[];
  readonly seen: SeenRuns;
}

/**
 * Brings a thread's panel and its groups' runs in line, both ways. First the panel's own changes
 * since it last caught up go into the runs: a group's tab it opened opens in its run, one it closed
 * closes there. The first time the panel catches up with a group (the thread just showed, or just
 * joined it), what it holds that the run never had (such as a pull request opened before the
 * group formed) joins the run, and what the run closed since closes. Then the panel takes the
 * runs as they stand: an entry closed in its run closes here, and one open there but missing
 * here opens where the run stands (`placeRunTabs`), a pull request through the thread's record.
 */
export function reconcilePanelRuns(input: PanelRunsInput): PanelRunsChange {
  let { arrangement, runs } = input;
  const addPullRequests: RunPullRequest[] = [];
  const removeSurfaceIds: string[] = [];
  const seen: Record<string, readonly string[]> = {};
  for (const group of input.groups) {
    const held = heldRunTabs(arrangement, group);
    const before = input.seen[group.key];
    const start = runs[group.key] ?? EMPTY_RUN;
    const known = new Set([
      ...start.open.map((entry) => runEntryId(group.key, entry)),
      ...start.closed,
    ]);
    const opened = [...held].flatMap(([id, key]): RunEntry[] => {
      if (before ? before.includes(id) : known.has(id)) return [];
      if (key === group.key) return [{ kind: "group" }];
      const surfaceId = surfaceIdOf(key);
      if (surfaceId === null) return [{ kind: "wiki-change-request", key }];
      const pullRequest = input.pullRequests.get(surfaceId);
      return pullRequest ? [{ kind: "pull-request", ...pullRequest }] : [];
    });
    const closedHere = before?.filter((id) => !held.has(id)) ?? [];
    runs = openRunEntries(closeRunEntries(runs, group.key, closedHere), group.key, opened);
    const run = runs[group.key] ?? EMPTY_RUN;

    const closed = new Set(run.closed);
    for (const [id, key] of held) {
      if (!closed.has(id)) continue;
      arrangement = closeTab(arrangement, key);
      const surfaceId = surfaceIdOf(key);
      if (surfaceId !== null) removeSurfaceIds.push(surfaceId);
    }
    const entries = run.open.filter((entry) => group.entryIds.has(runEntryId(group.key, entry)));
    const missing = entries.filter((entry) => !held.has(runEntryId(group.key, entry)));
    arrangement = placeRunTabs(
      arrangement,
      entries.map(
        (entry) => held.get(runEntryId(group.key, entry)) ?? runEntryTabKey(group.key, entry),
      ),
      new Set(missing.map((entry) => runEntryTabKey(group.key, entry))),
    );
    for (const entry of missing) {
      if (entry.kind !== "pull-request") continue;
      const { kind: _kind, ...pullRequest } = entry;
      addPullRequests.push(pullRequest);
    }
    seen[group.key] = heldRunIds(arrangement, group);
  }
  return { arrangement, runs, addPullRequests, removeSurfaceIds, seen };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(value: unknown): RunEntry | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "group":
      return { kind: "group" };
    case "wiki-change-request":
      return typeof value.key === "string" ? { kind: "wiki-change-request", key: value.key } : null;
    case "pull-request": {
      const { projectId, host, repository, number } = value;
      if (typeof projectId !== "string" || typeof repository !== "string") return null;
      if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) return null;
      return {
        kind: "pull-request",
        projectId,
        repository,
        number,
        ...(typeof host === "string" ? { host } : {}),
      };
    }
    default:
      return null;
  }
}

/** Stored runs as the panels can use them: well-formed entries, each group's held once. */
export function parseGroupPanelRuns(value: unknown): GroupPanelRuns {
  if (!isRecord(value)) return {};
  const runs: Record<string, GroupRun> = {};
  for (const [groupKey, stored] of Object.entries(value)) {
    if (!isRecord(stored) || !Array.isArray(stored.open) || !Array.isArray(stored.closed)) continue;
    const entries = stored.open.flatMap((entry) => {
      const parsed = parseEntry(entry);
      return parsed ? [parsed] : [];
    });
    const parsed = openRunEntries({}, groupKey, entries)[groupKey] ?? EMPTY_RUN;
    const closed = stored.closed.filter(
      (id): id is string =>
        typeof id === "string" && !parsed.open.some((entry) => runEntryId(groupKey, entry) === id),
    );
    runs[groupKey] = { open: parsed.open, closed: [...new Set(closed)] };
  }
  return runs;
}

/** The tabs the runs hold open beside their threads, as tab groups' numbers count open tabs. */
export function runTabKeys(runs: GroupPanelRuns): string[] {
  return Object.entries(runs).flatMap(([groupKey, run]) =>
    run.open.map((entry) => runEntryTabKey(groupKey, entry)),
  );
}

export const GROUP_PANEL_RUNS_STORAGE_KEY = "astrolabe:group-panel-runs:v1";

interface GroupPanelRunsState {
  readonly runs: GroupPanelRuns;
  /** Applies a change to the runs; the same runs back changes nothing. */
  readonly change: (change: (runs: GroupPanelRuns) => GroupPanelRuns) => void;
}

/** The device's shared runs, kept across reloads (`GROUP_PANEL_RUNS_STORAGE_KEY`). */
export const useGroupPanelRunsStore = create<GroupPanelRunsState>()(
  persist(
    (set) => ({
      runs: {},
      change: (change) =>
        set((state) => {
          const runs = change(state.runs);
          return runs === state.runs ? state : { runs };
        }),
    }),
    {
      name: GROUP_PANEL_RUNS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ runs }) => ({ runs }),
      merge: (persisted, current) => ({
        ...current,
        runs: parseGroupPanelRuns(isRecord(persisted) ? persisted.runs : undefined),
      }),
    },
  ),
);
