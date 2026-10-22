import { useEffect, useRef, useSyncExternalStore } from "react";

import { CHAT_TABS_STORAGE_KEY } from "~/chatTabs/chatTabsStore";
import { allTabs } from "./arrangement";
import { GROUP_PANEL_RUNS_STORAGE_KEY, parseGroupPanelRuns, runTabKeys } from "./groupPanelRuns";
import type { PaneArrangementStore } from "./panesHost";
import { arrangementStorageKey, parseArrangement } from "./persistence";

/**
 * Astrolabe: tab groups' numbers, one numbering across the window, on each group's marker in
 * every pane, section and the chat tabs. A group takes the lowest free number when a strip first
 * shows it, and keeps it while any tab it was shown holding is open on the device: in any pane
 * arrangement, the chat tabs, or a group's shared run beside its threads (`groupPanelRuns.ts`);
 * then the number is free again. Kept on the device, so numbers survive a reload.
 *
 * A group is known by the tabs it was seen with rather than by looking its tabs up again: the
 * change groups arrive from the servers after a reload, and a release made before they do would
 * free every number.
 */
export interface TabGroupNumber {
  readonly n: number;
  /** The tabs strips last showed in the group's runs, while they are open. */
  readonly keys: readonly string[];
}

/** By tab group id (`tabGroupId`). */
export type TabGroupNumbers = Readonly<Record<string, TabGroupNumber>>;

/** A group's run in a strip: its id and its tabs there. */
export interface TabGroupRunSeen {
  readonly id: string;
  readonly keys: readonly string[];
}

/** The lowest number from 1 that no group holds. */
export function lowestFreeNumber(numbers: TabGroupNumbers): number {
  const taken = new Set(Object.values(numbers).map((entry) => entry.n));
  let n = 1;
  while (taken.has(n)) n += 1;
  return n;
}

/**
 * Numbers the groups a strip shows (`runs`, in strip order): one numbered already keeps its
 * number and learns the run's tabs, a new one takes the lowest free number. The same object when
 * nothing changed.
 */
export function numberTabGroups(
  numbers: TabGroupNumbers,
  runs: readonly TabGroupRunSeen[],
): TabGroupNumbers {
  let next: Record<string, TabGroupNumber> | null = null;
  for (const { id, keys } of runs) {
    const entry = (next ?? numbers)[id];
    const learned = keys.filter((key) => !entry?.keys.includes(key));
    if (entry && learned.length === 0) continue;
    const n = entry?.n ?? lowestFreeNumber(next ?? numbers);
    next ??= { ...numbers };
    next[id] = { n, keys: [...(entry?.keys ?? []), ...learned] };
  }
  return next ?? numbers;
}

/**
 * Frees the numbers of groups none of whose tabs is in `open` (every tab any pane arrangement
 * holds), and forgets the closed tabs of the rest. The same object when nothing changed.
 */
export function releaseTabGroups(
  numbers: TabGroupNumbers,
  open: ReadonlySet<string>,
): TabGroupNumbers {
  let changed = false;
  const next: Record<string, TabGroupNumber> = {};
  for (const [id, entry] of Object.entries(numbers)) {
    const keys = entry.keys.filter((key) => open.has(key));
    if (keys.length !== entry.keys.length) changed = true;
    if (keys.length > 0) next[id] = keys.length === entry.keys.length ? entry : { ...entry, keys };
  }
  return changed ? next : numbers;
}

/** Stored numbers as the store can use them: whole numbers from 1, each held once. */
export function parseTabGroupNumbers(value: unknown): TabGroupNumbers {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const taken = new Set<number>();
  const numbers: Record<string, TabGroupNumber> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { n, keys } = entry as { n?: unknown; keys?: unknown };
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || taken.has(n)) continue;
    if (!Array.isArray(keys)) continue;
    const tabs = keys.filter((key): key is string => typeof key === "string");
    if (tabs.length === 0) continue;
    taken.add(n);
    numbers[id] = { n, keys: tabs };
  }
  return numbers;
}

type ReadableStorage = Pick<Storage, "length" | "key" | "getItem">;

// Where the pane hosts keep their arrangements: the threads' right panels and the Pull Requests
// area's under `persistence.ts`'s prefix, and the Wikis (`wikiPanes.ts`) and Repositories
// (`repositoryPanes.ts`) areas' under their own keys. A host added elsewhere joins here.
const PANEL_PREFIX = arrangementStorageKey("");
const SECTION_KEYS = new Set(["astrolabe:wiki-panes:v1", "astrolabe:repository-panes:v1"]);

/** What a zustand store keeps under `key`, inside its wrapper; null when unreadable. */
function storedState(storage: ReadableStorage, key: string): Record<string, unknown> | null {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  try {
    const raw = storage.getItem(key);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    return isRecord(stored) && isRecord(stored.state) ? stored.state : null;
  } catch {
    return null;
  }
}

/**
 * Every tab kept open on the device: the pane arrangements' tabs, the chat tabs
 * (`chatTabsStore.ts`), and the tabs of the change groups' shared runs (`groupPanelRuns.ts`).
 */
export function storedTabKeys(storage: ReadableStorage): Set<string> {
  const open = new Set<string>();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null || !(key.startsWith(PANEL_PREFIX) || SECTION_KEYS.has(key))) continue;
    try {
      const raw = storage.getItem(key);
      const arrangement = raw ? parseArrangement(JSON.parse(raw), () => true) : null;
      for (const tab of arrangement ? allTabs(arrangement) : []) open.add(tab);
    } catch {
      // Unreadable: it holds no tabs.
    }
  }
  const chats = storedState(storage, CHAT_TABS_STORAGE_KEY)?.keys;
  for (const chat of Array.isArray(chats) ? chats : []) {
    if (typeof chat === "string") open.add(chat);
  }
  const runs = parseGroupPanelRuns(storedState(storage, GROUP_PANEL_RUNS_STORAGE_KEY)?.runs);
  for (const tab of runTabKeys(runs)) open.add(tab);
  return open;
}

const STORAGE_KEY = "astrolabe:tab-group-numbers:v1";
/** Past the arrangements' own writes, 150 ms behind each change, so storage holds the change. */
const RELEASE_DELAY_MS = 250;

function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let numbers: TabGroupNumbers | null = null;
let releasing: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
/** The arrangements strips show, by how many strips show each: they may be ahead of storage. */
const shown = new Map<PaneArrangementStore, number>();

function current(): TabGroupNumbers {
  if (numbers === null) {
    const storage = deviceStorage();
    let stored: TabGroupNumbers = {};
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      stored = raw ? parseTabGroupNumbers(JSON.parse(raw)) : {};
    } catch {
      stored = {};
    }
    // Groups whose tabs all closed while the page was away come back free.
    numbers = storage ? releaseTabGroups(stored, storedTabKeys(storage)) : stored;
  }
  return numbers;
}

function save(next: TabGroupNumbers) {
  try {
    const storage = deviceStorage();
    if (Object.keys(next).length === 0) storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the numbers hold until the page goes away.
  }
}

function change(next: TabGroupNumbers) {
  if (next === current()) return;
  numbers = next;
  save(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Numbers the groups a strip shows, as `numberTabGroups` does. */
export function noteTabGroupRuns(runs: readonly TabGroupRunSeen[]) {
  if (runs.length > 0) change(numberTabGroups(current(), runs));
}

/**
 * Frees the numbers of groups with no tab left in any arrangement, once the arrangements have
 * written their latest change. Strips call it as they lose tabs (`useTabGroupRelease`); an
 * arrangement that loses tabs with no strip on screen is caught at the next loss or reload.
 */
function scheduleTabGroupRelease() {
  if (releasing) clearTimeout(releasing);
  releasing = setTimeout(() => {
    releasing = null;
    const storage = deviceStorage();
    if (!storage) return;
    const open = storedTabKeys(storage);
    for (const store of shown.keys()) {
      const snapshot = store.getSnapshot();
      for (const tab of snapshot ? allTabs(snapshot.arrangement) : []) open.add(tab);
    }
    change(releaseTabGroups(current(), open));
  }, RELEASE_DELAY_MS);
}

/**
 * Schedules a release whenever a strip showing these tabs (of `store`'s pane, or of the chat tabs,
 * which keep no arrangement) loses one, or goes away; while it is on screen, the release counts
 * `store`'s tabs as open.
 */
export function useTabGroupRelease(store: PaneArrangementStore | null, tabs: readonly string[]) {
  const held = useRef(tabs);
  useEffect(() => {
    const before = held.current;
    held.current = tabs;
    if (before.some((key) => !tabs.includes(key))) scheduleTabGroupRelease();
  }, [tabs]);
  useEffect(() => {
    if (store === null) return scheduleTabGroupRelease;
    shown.set(store, (shown.get(store) ?? 0) + 1);
    return () => {
      const strips = (shown.get(store) ?? 1) - 1;
      if (strips > 0) shown.set(store, strips);
      else shown.delete(store);
      scheduleTabGroupRelease();
    };
  }, [store]);
}

/** A tab group's number; none until a strip has shown the group. */
export function useTabGroupNumber(id: string): number | undefined {
  return useSyncExternalStore(subscribe, () => current()[id]?.n);
}
