import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { changeGroupEnvironment } from "~/state/changeGroups";
import type { ChangeGroupTab } from "./changeGroupTabs";

/**
 * Astrolabe: drafts started from a change group, by thread, which join it once their first
 * message sends. Kept in memory only, so a draft sent after a reload does not join.
 */
const joins = new Map<string, ChangeGroupTab>();
const keyOf = (ref: ScopedThreadRef) => `${ref.environmentId}\u0000${ref.threadId}`;

export function joinChangeGroupOnFirstSend(ref: ScopedThreadRef, group: ChangeGroupTab) {
  joins.set(keyOf(ref), { environmentId: group.environmentId, groupId: group.groupId });
}

/** The draft became its thread: it joins the group it was started from, if one. */
export function draftThreadSent(ref: ScopedThreadRef) {
  const group = joins.get(keyOf(ref));
  if (group === undefined) return;
  joins.delete(keyOf(ref));
  void runAtomCommand(appAtomRegistry, changeGroupEnvironment.update, {
    environmentId: group.environmentId,
    input: {
      groupId: group.groupId,
      change: {
        type: "add",
        member: { kind: "thread", threadId: ref.threadId },
        reason: "manual",
        note: "",
      },
    },
  }).then(() =>
    appAtomRegistry.refresh(
      changeGroupEnvironment.decisions({ environmentId: group.environmentId, input: {} }),
    ),
  );
}
