import { useSyncExternalStore } from "react";

/**
 * Astrolabe: one choice kept on the device under `storageKey`, read and written from anywhere and
 * watched by components, as a section's list filter is. `parse` turns what was stored into a
 * choice, or null for a choice no longer offered, which reads as `fallback`. Writing `fallback`
 * clears the key.
 */
export function storedChoice<T>({
  storageKey,
  fallback,
  parse,
  serialize = String,
}: {
  readonly storageKey: string;
  readonly fallback: T;
  readonly parse: (stored: string) => T | null;
  readonly serialize?: (choice: T) => string;
}) {
  const listeners = new Set<() => void>();
  let current: { readonly value: T } | null = null;

  const get = (): T => {
    if (current === null) {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(storageKey);
      } catch {
        // Blocked storage reads as nothing stored.
      }
      current = { value: stored === null ? fallback : (parse(stored) ?? fallback) };
    }
    return current.value;
  };
  const set = (next: T) => {
    current = { value: next };
    try {
      if (next === fallback) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, serialize(next));
    } catch {
      // Blocked storage: the choice still holds for this page.
    }
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  // Named as a hook, so the React Compiler keeps every call unconditional; a bare `use` reads to
  // it as React's `use`, which may be called conditionally.
  const useValue = (): T => useSyncExternalStore(subscribe, get);
  return { get, set, useValue };
}

/** A choice among a few names, the first being the default. */
export function storedName<const Names extends readonly [string, ...string[]]>(
  storageKey: string,
  names: Names,
) {
  return storedChoice<Names[number]>({
    storageKey,
    fallback: names[0],
    parse: (stored) => (names.includes(stored) ? stored : null),
  });
}
