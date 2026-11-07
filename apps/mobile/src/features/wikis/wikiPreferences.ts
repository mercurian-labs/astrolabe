import type { WikiLocationSettings } from "@t3tools/contracts";
import { DEFAULT_WIKI_LOCATION_SETTINGS } from "@t3tools/contracts";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import { useEnvironments } from "../../state/environments";

const STORAGE_KEY = "astrolabe.wikiShowHidden";

let showHidden = false;
const listeners = new Set<() => void>();

const change = (next: boolean) => {
  showHidden = next;
  for (const listener of listeners) listener();
};

void SecureStore.getItemAsync(STORAGE_KEY).then(
  (stored) => change(stored === "true"),
  () => undefined,
);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Whether this phone lists files and folders starting with a dot. */
export const useWikiShowHidden = () => useSyncExternalStore(subscribe, () => showHidden);

export function setWikiShowHidden(next: boolean) {
  change(next);
  void SecureStore.setItemAsync(STORAGE_KEY, String(next)).catch(() => undefined);
}

/** Where a server puts a wiki's new files, as Settings on a computer says. */
export function useWikiPlacement(environmentId: string): WikiLocationSettings {
  const { environments } = useEnvironments();
  return (
    environments.find((each) => each.environmentId === environmentId)?.serverConfig?.settings
      .wikiLocations ?? DEFAULT_WIKI_LOCATION_SETTINGS
  );
}
