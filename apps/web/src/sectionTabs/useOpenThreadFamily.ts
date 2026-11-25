import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { threadFamilies } from "~/state/threads";

/**
 * Keeps the family of an open thread the shell leaves out (an older settled thread) in the shell
 * rows until the chat leaves it, so every reader of its shell row finds it.
 */
export function useOpenThreadFamily(threadRef: ScopedThreadRef, missing: boolean) {
  const key = scopedThreadKey(threadRef);
  // Sticks to the chat's thread, so the row the family brings in does not release it.
  const [mountedKey, setMountedKey] = useState<string | null>(null);
  const nextKey = missing || mountedKey === key ? key : null;
  if (nextKey !== mountedKey) setMountedKey(nextKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the open thread's family in the thread family registry until the chat leaves it
  useEffect(() => {
    const ref = mountedKey === null ? null : parseScopedThreadKey(mountedKey);
    if (ref === null) return;
    return threadFamilies.mount(appAtomRegistry, ref.environmentId, ref.threadId);
  }, [mountedKey]);
}
