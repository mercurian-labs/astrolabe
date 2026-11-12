import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { resolveStorage } from "~/lib/storage";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { changeGroupEnvironment } from "~/state/changeGroups";
import type { ChangeGroupTab } from "./changeGroupTabs";

/**
 * Astrolabe: a draft started from a change group, which joins the group once its first message
 * sends. Saved beside the draft itself, so a draft sent after a reload still joins.
 */
const ChangeGroupDraft = Schema.Struct({
  draftId: DraftId,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  groupId: Schema.String,
});
export type ChangeGroupDraft = typeof ChangeGroupDraft.Type;
const isChangeGroupDraft = Schema.is(ChangeGroupDraft);

interface ChangeGroupDraftState {
  /** By draft id. A discarded draft's entry stays until the next join, so Undo keeps it. */
  readonly drafts: Readonly<Record<string, ChangeGroupDraft>>;
}

export const useChangeGroupDraftStore = create<ChangeGroupDraftState>()(
  persist(() => ({ drafts: {} }), {
    name: "astrolabe:change-group-drafts:v1",
    storage: createJSONStorage(() =>
      resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    ),
    version: 1,
    merge: (persisted, current) => {
      const drafts = (persisted as Partial<ChangeGroupDraftState> | null)?.drafts;
      return {
        ...current,
        drafts: Object.fromEntries(
          Object.entries(drafts ?? {}).filter(([, draft]) => isChangeGroupDraft(draft)),
        ),
      };
    },
  }),
);

export function joinChangeGroupOnFirstSend(
  draftId: DraftId,
  ref: ScopedThreadRef,
  group: ChangeGroupTab,
) {
  const sessions = useComposerDraftStore.getState().draftThreadsByThreadKey;
  useChangeGroupDraftStore.setState((state) => ({
    drafts: {
      ...Object.fromEntries(Object.entries(state.drafts).filter(([id]) => id in sessions)),
      [draftId]: {
        draftId,
        environmentId: ref.environmentId,
        threadId: ref.threadId,
        groupId: group.groupId,
      },
    },
  }));
}

/** An unsent draft started from a group, with what its composer holds now. */
export interface OpenChangeGroupDraft extends ChangeGroupDraft {
  readonly prompt: string;
}

/** The drafts started from `group` that are still unsent here, oldest first. */
export function useChangeGroupDrafts(group: ChangeGroupTab): ReadonlyArray<OpenChangeGroupDraft> {
  const entries = useChangeGroupDraftStore(
    useShallow((state) =>
      Object.values(state.drafts).filter(
        (draft) => draft.environmentId === group.environmentId && draft.groupId === group.groupId,
      ),
    ),
  );
  // One string per entry, or null once its draft is sent or discarded, so a keystroke elsewhere
  // does not render the group.
  const prompts = useComposerDraftStore(
    useShallow((state) =>
      entries.map((draft) => {
        const session = state.draftThreadsByThreadKey[draft.draftId];
        if (!session || session.promotedTo) return null;
        return state.draftsByThreadKey[draft.draftId]?.prompt ?? "";
      }),
    ),
  );
  return entries.flatMap((draft, index) => {
    const prompt = prompts[index];
    return prompt === null || prompt === undefined ? [] : [{ ...draft, prompt }];
  });
}

/** The draft became its thread: it joins the group it was started from, if one. */
export function draftThreadSent(ref: ScopedThreadRef) {
  const draft = Object.values(useChangeGroupDraftStore.getState().drafts).find(
    (each) => each.environmentId === ref.environmentId && each.threadId === ref.threadId,
  );
  if (draft === undefined) return;
  useChangeGroupDraftStore.setState((state) => {
    const { [draft.draftId]: _sent, ...drafts } = state.drafts;
    return { drafts };
  });
  void runAtomCommand(appAtomRegistry, changeGroupEnvironment.update, {
    environmentId: draft.environmentId,
    input: {
      groupId: draft.groupId,
      change: {
        type: "add",
        member: { kind: "thread", threadId: draft.threadId },
        reason: "manual",
        note: "",
      },
    },
  }).then(() =>
    appAtomRegistry.refresh(
      changeGroupEnvironment.decisions({ environmentId: draft.environmentId, input: {} }),
    ),
  );
}
