import type { EnvironmentId, PullRequestLinkedThreadsResult } from "@t3tools/contracts";

export interface CommandPaletteLinkedThreads {
  readonly environmentId: EnvironmentId;
  readonly threads: PullRequestLinkedThreadsResult["threads"];
}

const COMMAND_PALETTE_OPEN_EVENT = "t3code:open-command-palette";

export interface CommandPaletteOpenDetail {
  // Astrolabe: or the file picker, which the keyboard menu's `f` opens.
  readonly open?: "add-project" | "new-thread-in" | "files";
  readonly query?: string;
  readonly linkedThreads?: CommandPaletteLinkedThreads;
}

// Astrolabe: a request made before the palette mounts (Vim's `:` just after a page load) waits
// for it, instead of being lost along with the key that asked.
let listeners = 0;
let pendingOpen: CommandPaletteOpenDetail | null = null;

export function openCommandPalette(detail?: CommandPaletteOpenDetail): void {
  if (listeners === 0) {
    pendingOpen = detail ?? {};
    return;
  }
  window.dispatchEvent(
    new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, detail ? { detail } : undefined),
  );
}

export function onOpenCommandPalette(
  listener: (detail: CommandPaletteOpenDetail) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<CommandPaletteOpenDetail>).detail ?? {});
  };
  window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
  listeners += 1;
  if (pendingOpen !== null) {
    const detail = pendingOpen;
    pendingOpen = null;
    listener(detail);
  }
  return () => {
    window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
    listeners -= 1;
  };
}

export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
