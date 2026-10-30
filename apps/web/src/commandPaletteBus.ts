import type { EnvironmentId, PullRequestLinkedThreadsResult } from "@t3tools/contracts";

import type { CommandPaletteUiAction } from "./components/CommandPalette.logic";
import { requestCommandPalette } from "./commandPaletteStore";

export interface CommandPaletteLinkedThreads {
  readonly environmentId: EnvironmentId;
  readonly threads: PullRequestLinkedThreadsResult["threads"];
}

export interface CommandPaletteOpenDetail {
  // Astrolabe: or the file picker, which the keyboard menu's `f` opens, or adding a wiki.
  readonly open?: "add-project" | "add-wiki" | "new-thread-in" | "files";
  readonly query?: string;
  readonly linkedThreads?: CommandPaletteLinkedThreads;
}

export function openCommandPalette(detail: CommandPaletteOpenDetail = {}): void {
  requestCommandPalette(commandPaletteOpenAction(detail));
}

function commandPaletteOpenAction(detail: CommandPaletteOpenDetail): CommandPaletteUiAction {
  if (detail.open === "new-thread-in") return { _tag: "OpenNewThreadIn" };
  if (detail.open === "add-project") return { _tag: "OpenAddProject" };
  if (detail.open === "add-wiki") return { _tag: "OpenAddProject", target: "wiki" };
  // Astrolabe: the keyboard menu, which never opens over the palette, opens the file picker.
  if (detail.open === "files") return { _tag: "ToggleMode", mode: "files" };
  if (detail.query !== undefined) {
    return {
      _tag: "OpenSearch",
      query: detail.query,
      ...(detail.linkedThreads ? { linkedThreads: detail.linkedThreads } : {}),
    };
  }
  return { _tag: "SetOpen", open: true };
}

/** True while the palette popup is on screen, including its closing animation. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
