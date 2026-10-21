import { useSyncExternalStore } from "react";

/**
 * Astrolabe: which change requests the Change Requests section lists: every kind, or only the
 * wikis'. A host picked in the provider menu lists only that host's pull requests. Kept on the
 * device beside the list's other preferences.
 */
export type ChangeRequestKind = "all" | "wikis";

const STORAGE_KEY = "astrolabe:change-request-kind:v1";
const listeners = new Set<() => void>();

function read(): ChangeRequestKind {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "wikis" ? "wikis" : "all";
  } catch {
    return "all";
  }
}

let current: ChangeRequestKind | null = null;

export function changeRequestKind(): ChangeRequestKind {
  current ??= read();
  return current;
}

export function setChangeRequestKind(next: ChangeRequestKind) {
  current = next;
  try {
    if (next === "all") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Blocked storage: the choice still holds for this page.
  }
  for (const listener of listeners) listener();
}

export function useChangeRequestKind(): ChangeRequestKind {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, changeRequestKind);
}
