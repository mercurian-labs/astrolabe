import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type ChangeGroupChange, type EnvironmentId } from "@t3tools/contracts";
import type { ChangeGroupMember } from "@t3tools/shared/changeGroups";

import { newMessageId } from "~/lib/utils";
import { surfaceKey } from "~/panes/arrangement";
import { pullRequestSurfaceId } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { changeGroupEnvironment } from "~/state/changeGroups";
import { readThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { toastManager } from "../../ui/toast";
import { wikiTabKey } from "../../wiki/wikiTabs";
import { chatTabKey } from "~/sectionTabs/sectionTabs";

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

/**
 * Asks a thread's agent to do something for the group, as a message queued behind whatever it is
 * doing, in the thread's own modes. False when the thread is gone or the message did not send.
 */
export function useAskThread() {
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return async (environmentId: EnvironmentId, threadId: string, text: string) => {
    const thread = readThreadShell(scopeThreadRef(environmentId, ThreadId.make(threadId)));
    if (thread === null) return false;
    const result = await startTurn({
      environmentId,
      input: {
        threadId: thread.id,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        dispatchMode: "queue",
      },
    });
    const sent = result._tag === "Success";
    toastManager.add(
      sent
        ? { type: "success", title: `Asked “${thread.title}”` }
        : { type: "error", title: "The message could not be sent" },
    );
    return sent;
  };
}
