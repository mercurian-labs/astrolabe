import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { useSyncExternalStore } from "react";

import { subscribeAtomChanges } from "~/rpc/atomRegistry";
import { parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { readThreadShell } from "~/state/entities";
import { environmentThreadShells } from "~/state/threads";

const subscribe = (listener: () => void) =>
  subscribeAtomChanges(environmentThreadShells.threadShellsAtom, listener);

/**
 * Astrolabe: the chats among `keys` with live work, a turn running or an approval or question
 * waiting, which stay mounted out of sight (`recentChats`). Joined into one string so the tab
 * contents re-render only when the set changes.
 */
export function useBusyChats(keys: readonly string[]): ReadonlySet<string> {
  const joined = useSyncExternalStore(subscribe, () =>
    keys
      .filter((key) => {
        const ref = parseChatTabKey(key);
        const shell = ref ? readThreadShell(ref) : null;
        return (
          shell !== null &&
          (shell.hasPendingApprovals ||
            shell.hasPendingUserInput ||
            threadRuntimeIsActive(shell.runtime))
        );
      })
      .join("\n"),
  );
  return new Set(joined === "" ? [] : joined.split("\n"));
}
