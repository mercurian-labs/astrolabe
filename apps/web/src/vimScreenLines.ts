import { setVimScreenLineMotion } from "@mercurian/editor/vim";
import { useEffect } from "react";

import { useClientSettings } from "./hooks/useSettings";

/**
 * Astrolabe: applies this device's "Move by screen line" (Settings › Keybindings) to Vim's j and
 * k, from an editor that runs Vim. One setting for every such editor on the page.
 */
export function useVimScreenLines() {
  const on = useClientSettings((settings) => settings.vimScreenLinesEnabled);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sets the Vim module's screen-line motion flag from the client setting
  useEffect(() => setVimScreenLineMotion(on), [on]);
}
