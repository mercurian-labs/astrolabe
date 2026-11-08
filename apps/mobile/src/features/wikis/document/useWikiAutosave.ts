import { usePreventRemove, useNavigation } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  createWikiAutosave,
  type WikiAutosaveStatus,
  type WikiSaveOutcome,
} from "@t3tools/client-runtime/wikiAutosave";
import { wikiSaveFailure } from "@t3tools/client-runtime/wikiLogic";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import * as Dialog from "../../../components/ui/Dialog";
import { useAtomCommand } from "../../../state/use-atom-command";
import { wikiEnvironment } from "../../../state/wiki";

/** Lands an autosave, reading a failure as the autosave store does. */
export function useWikiAutosaveCommand() {
  const run = useAtomCommand(wikiEnvironment.autosave, { reportFailure: false });
  return async (value: Parameters<typeof run>[0]) => {
    const result = await run(value);
    if (result._tag === "Success") return { ok: true as const, value: result.value };
    return isAtomCommandInterrupted(result)
      ? { ok: false as const, message: "The save was cancelled.", retry: true }
      : wikiSaveFailure(squashAtomCommandFailure(result));
  };
}

/** The status line a screen's subtitle carries, or null when there's nothing to say. */
export function wikiSaveLabel(status: WikiAutosaveStatus): string | null {
  switch (status.kind) {
    case "saving":
      return "Saving…";
    case "waiting-for-turn":
      return "saves when the turn ends";
    case "failed":
      return "Not saved";
    case "idle":
      return status.saved ? "Saved" : null;
  }
}

/**
 * A document's autosave. It saves when the app goes to the background. Leaving lands what's
 * unsaved first, and asks only if that can't happen: the page holding the edits goes with the
 * screen, so nothing can land after it.
 */
export function useWikiAutosave(input: {
  readonly subject: string;
  readonly save: () => Promise<WikiSaveOutcome>;
  readonly delayMs?: number;
}) {
  const navigation = useNavigation();
  const [{ autosave, follow }] = useState(() => {
    let latest = input.save;
    return {
      autosave: createWikiAutosave({
        save: () => latest(),
        ...(input.delayMs === undefined ? {} : { delayMs: input.delayMs }),
      }),
      follow: (next: () => Promise<WikiSaveOutcome>) => {
        latest = next;
      },
    };
  });
  const status = useSyncExternalStore(autosave.subscribe, autosave.getStatus);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the store's timers run outside React and read the latest save
  useLayoutEffect(() => follow(input.save));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the operating system says when the app leaves the foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void autosave.flush();
    });
    return () => subscription.remove();
  }, [autosave]);
  usePreventRemove(status.kind !== "idle", ({ data }) => {
    void autosave.flush().then((landed) => {
      if (landed) {
        navigation.dispatch(data.action);
        return;
      }
      Dialog.confirm({
        title: "Discard your edits?",
        message: `Your edits to ${input.subject} aren't saved, and leaving loses them.`,
        cancelText: "Keep editing",
        confirmText: "Discard",
        destructive: true,
        onConfirm: () => {
          autosave.cancel();
          navigation.dispatch(data.action);
        },
      });
    });
  });
  return { autosave, status };
}
