import type { LayoutSettings } from "@t3tools/contracts/settings";

import {
  getClientSettings,
  getClientSettingsHydrationStatusSnapshot,
  subscribeClientSettings,
  subscribeClientSettingsHydration,
} from "~/hooks/useSettings";

/**
 * How the panes behave when things open: where the terminal and a chat's side tabs go, and where
 * a pane adds a tab. Settings › General › Panes sets these for this client. Client settings arrive
 * after the first render, so `known` says whether `read` is settled yet. A failed read counts: the
 * defaults are all there will be, and the panes must not wait on them forever.
 */
export interface LayoutBehavior {
  readonly read: () => LayoutSettings;
  readonly known: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

/** A retry follows a failed read, so settings known once stay known through it. */
export const settingsSettled = (
  status: ReturnType<typeof getClientSettingsHydrationStatusSnapshot>,
) => status !== "pending";

export const clientLayoutBehavior: LayoutBehavior = {
  read: () => getClientSettings().layout,
  known: () => settingsSettled(getClientSettingsHydrationStatusSnapshot()),
  subscribe(listener) {
    const stopSettings = subscribeClientSettings(listener);
    const stopHydration = subscribeClientSettingsHydration(listener);
    return () => {
      stopSettings();
      stopHydration();
    };
  },
};

export const getLayoutBehavior = clientLayoutBehavior.read;
