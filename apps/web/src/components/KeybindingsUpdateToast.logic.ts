import type { ServerConfigStreamEvent, VimrcIssue } from "@t3tools/contracts";

export const KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS = 2_000;

export type KeybindingsUpdateToastDecision =
  | { readonly _tag: "Success" }
  | { readonly _tag: "InvalidConfiguration"; readonly message: string }
  // Astrolabe: the vimrc, beside keybindings.json.
  | { readonly _tag: "VimrcSuccess" }
  | { readonly _tag: "InvalidVimrc"; readonly message: string };

/** Astrolabe: a vimrc's issues as one line: the first, and how many more. */
function vimrcIssuesMessage(issues: readonly VimrcIssue[]): string {
  const [first] = issues;
  if (!first) return "";
  const message =
    first.kind === "vimrc.invalid-line" ? `Line ${first.line}: ${first.message}` : first.message;
  const more = issues.length - 1;
  return more > 0 ? `${message} (and ${more} more ${more === 1 ? "line" : "lines"})` : message;
}

export interface KeybindingsUpdateToastController {
  readonly handle: (event: ServerConfigStreamEvent | null) => KeybindingsUpdateToastDecision | null;
}

export function createKeybindingsUpdateToastController(input: {
  readonly now?: () => number;
}): KeybindingsUpdateToastController {
  const now = input.now ?? Date.now;
  let lastSuccessToastAt: number | null = null;
  // Astrolabe: a vimrc keeps the lines it cannot apply, so the same issues warn once, not on
  // every later save.
  let lastVimrcIssues = "[]";

  return {
    handle: (event) => {
      if (event?.type === "vimrcUpdated") {
        const { issues } = event.payload.vimrc;
        const signature = JSON.stringify(issues);
        const changed = signature !== lastVimrcIssues;
        lastVimrcIssues = signature;
        if (issues.length > 0 && changed) {
          return { _tag: "InvalidVimrc", message: vimrcIssuesMessage(issues) };
        }
        const currentTime = now();
        if (
          lastSuccessToastAt !== null &&
          currentTime - lastSuccessToastAt < KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS
        ) {
          return null;
        }
        lastSuccessToastAt = currentTime;
        return { _tag: "VimrcSuccess" };
      }
      if (event?.type !== "keybindingsUpdated") {
        return null;
      }

      const issue = event.payload.issues.find((entry) => entry.kind.startsWith("keybindings."));
      if (issue) {
        return {
          _tag: "InvalidConfiguration",
          message: issue.message,
        };
      }

      const currentTime = now();
      if (
        lastSuccessToastAt !== null &&
        currentTime - lastSuccessToastAt < KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS
      ) {
        return null;
      }

      lastSuccessToastAt = currentTime;
      return { _tag: "Success" };
    },
  };
}
