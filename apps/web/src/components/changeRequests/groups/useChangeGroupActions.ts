import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type ChangeGroupChange, type EnvironmentId } from "@t3tools/contracts";
import type { ChangeGroupMember } from "@t3tools/shared/changeGroups";

import { changeGroupContextRecord } from "@t3tools/shared/composerContextReferences";

import { useComposerDraftStore, type ComposerThreadTarget } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { formatInlineContextReference } from "~/lib/composerContextReferences";
import { wikiContextReference } from "~/lib/composerContextRecords";
import { surfaceKey } from "~/panes/arrangement";
import { pullRequestSurfaceId } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { changeGroupEnvironment } from "~/state/changeGroups";
import { readThreadShell } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../../ui/toast";
import { wikiTabKey } from "../../wiki/wikiTabs";
import { chatTabKey } from "~/sectionTabs/sectionTabs";
import { joinChangeGroupOnFirstSend, useChangeGroupDraftStore } from "./changeGroupJoins";

/**
 * The tab a member opens in: a pull request's (named by the project of the thread that linked
 * it), a wiki change request's, or a thread's chat. Null for a pull request whose thread is gone.
 */
export function changeGroupMemberTabKey(
  environmentId: EnvironmentId,
  member: ChangeGroupMember,
): string | null {
  const { ref } = member;
  if (ref.kind === "thread") {
    return chatTabKey(scopeThreadRef(environmentId, ThreadId.make(ref.threadId)));
  }
  if (ref.kind === "wiki-change-request") {
    return wikiTabKey({
      kind: "change-request",
      environmentId,
      wikiId: ref.wikiId,
      changeRequestId: ref.changeRequestId,
    });
  }
  const thread =
    member.threadId === null
      ? null
      : readThreadShell(scopeThreadRef(environmentId, ThreadId.make(member.threadId)));
  if (thread === null) return null;
  return surfaceKey(
    pullRequestSurfaceId({
      environmentId,
      projectId: thread.projectId,
      host: ref.host,
      repository: ref.repository,
      number: ref.number,
    }),
  );
}

/** Records one decision about a group, then reads the group's decisions again. */
export function useUpdateChangeGroup() {
  const update = useAtomCommand(changeGroupEnvironment.update);
  return async (
    group: Pick<EnvironmentChangeGroup, "environmentId" | "groupId">,
    change: ChangeGroupChange,
  ) => {
    const result = await update({
      environmentId: group.environmentId,
      input: { groupId: group.groupId, change },
    });
    appAtomRegistry.refresh(
      changeGroupEnvironment.decisions({ environmentId: group.environmentId, input: {} }),
    );
    return result._tag === "Success";
  };
}

/** The chip naming a group, at the start of a draft's prompt or after what it holds. */
function placeGroupChip(target: ComposerThreadTarget, group: EnvironmentChangeGroup) {
  const store = useComposerDraftStore.getState();
  const record = changeGroupContextRecord(group);
  const existing = store.getComposerDraft(target)?.wikiContexts ?? [];
  store.setWikiContexts(target, [
    ...existing.filter((each) => each.contextId !== record.contextId),
    record,
  ]);
}

/**
 * Starts a thread for the group, as a new thread in its root thread's project does, with the
 * group's chip and `sentence` in the draft, opened by `show`. It joins the group on its first
 * send (`joinChangeGroupOnFirstSend`); a draft never sent adds nothing. A draft from the group
 * still holding just that is shown again instead.
 */
export function useStartChangeGroupThread(show: (chatKey: string) => void) {
  const newThread = useNewThreadHandler();
  return async (group: EnvironmentChangeGroup, sentence = "") => {
    const reference = formatInlineContextReference(
      wikiContextReference(changeGroupContextRecord(group)),
    );
    const prompt = `${reference} ${sentence}`;
    const untouched = untouchedChangeGroupDraft(group, prompt);
    if (untouched !== undefined) {
      show(chatTabKey(scopeThreadRef(group.environmentId, untouched.threadId)));
      return;
    }
    const project = [group.groupId, ...group.threadIds]
      .map((threadId) =>
        readThreadShell(scopeThreadRef(group.environmentId, ThreadId.make(threadId))),
      )
      .find((shell) => shell !== null)?.projectId;
    if (project === undefined) {
      toastManager.add({ type: "error", title: "This group's threads are gone" });
      return;
    }
    const opened = await newThread(scopeProjectRef(group.environmentId, project), { prompt });
    if (opened === null) return;
    placeGroupChip(opened.draftId, group);
    const ref = scopeThreadRef(group.environmentId, opened.threadId);
    joinChangeGroupOnFirstSend(opened.draftId, ref, group);
    show(chatTabKey(ref));
  };
}

function untouchedChangeGroupDraft(group: EnvironmentChangeGroup, prompt: string) {
  const composer = useComposerDraftStore.getState();
  return Object.values(useChangeGroupDraftStore.getState().drafts).find((draft) => {
    const session = composer.draftThreadsByThreadKey[draft.draftId];
    const held = composer.draftsByThreadKey[draft.draftId];
    return (
      draft.environmentId === group.environmentId &&
      draft.groupId === group.groupId &&
      session !== undefined &&
      !session.promotedTo &&
      held !== undefined &&
      held.prompt.trim() === prompt.trim() &&
      held.images.length === 0 &&
      held.files.length === 0
    );
  });
}

/** Adds a thread to the group, puts the group's chip in its draft unsent, and opens it. */
export async function pointThreadAtChangeGroup(
  group: EnvironmentChangeGroup,
  threadId: ThreadId,
  update: ReturnType<typeof useUpdateChangeGroup>,
  show: (chatKey: string) => void,
) {
  const ref = scopeThreadRef(group.environmentId, threadId);
  placeGroupChip(ref, group);
  show(chatTabKey(ref));
  await update(group, {
    type: "add",
    member: { kind: "thread", threadId },
    reason: "manual",
    note: "",
  });
}
