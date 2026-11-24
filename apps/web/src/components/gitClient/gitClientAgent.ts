import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentId, GitClientTurn, ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftStore } from "~/composerDraftStore";
import type { NewThreadHandler } from "~/hooks/useHandleNewThread";
import { workspace } from "~/panes/workspace";
import { leafWithTab } from "~/panes/tree";
import { chatTabKey } from "~/sectionTabs/sectionTabs";
import { turnReveal } from "../chat/turnReveal";
import { appendAsk } from "./gitClientLogic";

/** The checkout the Git tab reads, and the project it belongs to. */
export interface GitCheckout {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  /** The project's own folder: a thread with no worktree works there. */
  readonly workspaceRoot: string | null;
  readonly branch: string | null;
}

/** The threads working in the checkout, the most recently active first. */
export function checkoutThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  checkout: GitCheckout,
): ReadonlyArray<EnvironmentThreadShell> {
  return threads
    .filter(
      (thread) =>
        thread.environmentId === checkout.environmentId &&
        thread.projectId === checkout.projectId &&
        thread.archivedAt === null &&
        (thread.worktreePath ?? checkout.workspaceRoot) === checkout.cwd,
    )
    .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * Shows a chat beside the Git tab: where it is open in another pane it comes to the front there;
 * else it opens beside the tab's pane.
 */
function showChatBeside(ref: ScopedThreadRef, gitTabKey: string) {
  const key = chatTabKey(ref);
  const { root } = workspace.arrangement();
  const gitPane = leafWithTab(root, gitTabKey);
  const chatPane = leafWithTab(root, key);
  if (chatPane !== undefined && chatPane.id !== gitPane?.id) {
    workspace.open(key);
    return;
  }
  workspace.open(key, "beside", gitPane?.id);
}

/**
 * Hands an ask to the agent: into the composer of `thread`, or of a new draft thread in the
 * checkout when there is none, then shows that chat beside the Git tab. Nothing is sent.
 */
export async function handToAgent(input: {
  readonly ask: string;
  readonly thread: ScopedThreadRef | null;
  readonly checkout: GitCheckout;
  readonly gitTabKey: string;
  readonly newThread: NewThreadHandler;
}) {
  const store = useComposerDraftStore.getState();
  if (input.thread !== null) {
    store.setPrompt(
      input.thread,
      appendAsk(store.getComposerDraft(input.thread)?.prompt ?? "", input.ask),
    );
    showChatBeside(input.thread, input.gitTabKey);
    return;
  }
  const { checkout } = input;
  const inRoot = checkout.workspaceRoot === checkout.cwd;
  const opened = await input.newThread(
    scopeProjectRef(checkout.environmentId, checkout.projectId),
    {
      worktreePath: inRoot ? null : checkout.cwd,
      branch: checkout.branch,
      envMode: inRoot ? "local" : "worktree",
    },
  );
  if (opened === null) return;
  const draft = useComposerDraftStore.getState();
  draft.setPrompt(
    opened.draftId,
    appendAsk(draft.getComposerDraft(opened.draftId)?.prompt ?? "", input.ask),
  );
  showChatBeside(scopeThreadRef(checkout.environmentId, opened.threadId), input.gitTabKey);
}

/** Shows the turn's chat beside the Git tab, scrolled to the person's message that started it. */
export function openTurn(environmentId: EnvironmentId, turn: GitClientTurn, gitTabKey: string) {
  const ref = scopeThreadRef(environmentId, turn.threadId);
  if (turn.userMessageId !== null) turnReveal.request(scopedThreadKey(ref), turn.userMessageId);
  showChatBeside(ref, gitTabKey);
}
