import { useAtomValue } from "@effect/atom-react";
import { threadFamilyRead, type ThreadFamilyRead } from "@t3tools/client-runtime/state/threads";
import type { OrchestrationV2ThreadFamily, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { MessagesSquare } from "lucide-react";
import { memo, useEffect, useState, type ReactNode } from "react";

import { resolveComposerProviderSelection } from "~/components/ChatView.logic";
import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { sortProviderInstanceEntries } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { readThreadShell, useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { providerEntriesByEnvironmentAtom } from "~/state/server";
import { environmentShell } from "~/state/shell";
import { threadFamilies } from "~/state/threads";
import { isThreadRouteSnapshotAuthoritative } from "~/threadRoutes";

/** Where a chat's tab leads: its server thread, or its draft while it is one. */
export type ChatRoute =
  | { readonly kind: "thread"; readonly ref: ScopedThreadRef }
  | { readonly kind: "draft"; readonly draftId: DraftId };

/**
 * Where a chat leads, read now: its server thread while it exists, else its draft; null for a
 * chat gone (deleted, or a draft discarded).
 */
export function chatRouteOf(chatKey: string): ChatRoute | null {
  const ref = parseChatTabKey(chatKey);
  if (!ref) return null;
  const shell = readThreadShell(ref);
  if (shell && shell.deletedAt == null) return { kind: "thread", ref };
  const draftId = useComposerDraftStore.getState().getDraftIdByRef(ref);
  if (draftId) return { kind: "draft", draftId };
  // A thread the shell has not listed yet may still load.
  return shell === null ? { kind: "thread", ref } : null;
}

/**
 * Whether a tab's chat is gone, so the tab closes. Cold connect leaves older settled threads and
 * idle subagents out of the shell, so a thread missing there is gone only once a settled read of
 * its family leaves it out too.
 */
function isChatTabGone(input: {
  readonly live: boolean;
  readonly shell: { readonly deletedAt?: unknown } | null;
  readonly hasDraft: boolean;
  readonly familyRead: ThreadFamilyRead;
}): boolean {
  if (!input.live || input.hasDraft) return false;
  if (input.shell !== null) return input.shell.deletedAt != null;
  return input.familyRead === "settled";
}

const NO_FAMILY_READ: Atom.Atom<AsyncResult.AsyncResult<OrchestrationV2ThreadFamily, unknown>> =
  Atom.make(AsyncResult.initial<never, never>(true)).pipe(Atom.withLabel("chat-tab:no-family"));

/**
 * Cold connect leaves older settled threads and idle subagents out of the shell. A tab showing one
 * mounts its family, which brings the row back and decides whether the thread is gone. Held once
 * needed, since the row it brings in would otherwise unmount it.
 */
function useUnlistedThreadFamilyRead(
  ref: ScopedThreadRef | null,
  unlisted: boolean,
): ThreadFamilyRead {
  const [needed, setNeeded] = useState(false);
  if (unlisted && !needed && ref !== null) setNeeded(true);
  const environmentId = needed ? (ref?.environmentId ?? null) : null;
  const threadId = needed ? (ref?.threadId ?? null) : null;
  // oxlint-disable-next-line t3code/react-effect-budget -- mounts the thread's family in the atom registry
  useEffect(() => {
    if (environmentId === null || threadId === null) return;
    return threadFamilies.mount(appAtomRegistry, environmentId, threadId);
  }, [environmentId, threadId]);
  return threadFamilyRead(
    useAtomValue(
      environmentId !== null && threadId !== null
        ? threadFamilies.familyAtom(environmentId, threadId)
        : NO_FAMILY_READ,
    ),
  );
}

/**
 * Closes a chat's tab once its chat is gone (deleted, or a draft discarded), as soon as its
 * environment's threads are known. Renders nothing; one per open chat.
 */
export const ChatTabWatch = memo(function ChatTabWatch({
  chatKey,
  onGone,
}: {
  readonly chatKey: string;
  readonly onGone: (chatKey: string) => void;
}) {
  const ref = parseChatTabKey(chatKey);
  const shell = useThreadShell(ref);
  const hasDraft = useComposerDraftStore((store) =>
    shell || !ref ? false : store.getDraftIdByRef(ref) !== null,
  );
  const live = isThreadRouteSnapshotAuthoritative(
    useEnvironmentQuery(ref ? environmentShell.stateAtom(ref.environmentId) : null).data?.status,
  );
  const familyRead = useUnlistedThreadFamilyRead(ref, shell === null && !hasDraft);
  const gone = ref === null ? live : isChatTabGone({ live, shell, hasDraft, familyRead });
  // Read again at close: a family read already cached can settle before its rows mount.
  // oxlint-disable-next-line t3code/react-effect-budget -- closes the tab once the server says the chat is gone
  useEffect(() => {
    if (!gone || ref === null) return;
    const now = readThreadShell(ref);
    if (now && now.deletedAt == null) return;
    if (useComposerDraftStore.getState().getDraftIdByRef(ref)) return;
    onGone(chatKey);
  }, [chatKey, gone, onGone, ref]);
  return null;
});

/**
 * A chat tab's title and icon, as its sidebar row draws them: its harness's icon (a thread's
 * running or selected instance; a draft's composer pick, else the instance it falls back to).
 */
export function useChatTabLabel(chatKey: string): { title: string; icon: ReactNode } | null {
  const ref = parseChatTabKey(chatKey);
  const shell = useThreadShell(ref);
  const draftId = useComposerDraftStore((store) =>
    shell || !ref ? null : store.getDraftIdByRef(ref),
  );
  const draftProvider = useComposerDraftStore((store) =>
    draftId ? (store.getComposerDraft(draftId)?.activeProvider ?? null) : null,
  );
  const providerEntriesByEnvironment = useAtomValue(providerEntriesByEnvironmentAtom);
  if (ref === null) return null;
  const threadProvider = shell
    ? (shell.runtime?.providerInstanceId ?? shell.modelSelection.instanceId)
    : null;
  const providerEntries = providerEntriesByEnvironment.get(ref.environmentId);
  const providerEntry = !providerEntries
    ? null
    : threadProvider !== null
      ? (providerEntries.get(threadProvider) ?? null)
      : !draftId
        ? null
        : (resolveComposerProviderSelection({
            entries: sortProviderInstanceEntries([...providerEntries.values()]),
            candidateInstanceIds: [draftProvider],
            lockedProvider: null,
            lockedInstanceId: null,
          }).selectedProviderEntry ?? null);
  return {
    // A thread not yet sent has no title of its own.
    title: shell?.title ?? "New thread",
    icon: providerEntry ? (
      // No instance badge: at this size it would cover the glyph.
      <ProviderInstanceIcon
        driverKind={providerEntry.driverKind}
        displayName={providerEntry.displayName}
        accentColor={providerEntry.accentColor}
        acpRegistryAgentId={providerEntry.acpRegistryAgentId}
        acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
        iconClassName="size-3"
      />
    ) : (
      <MessagesSquare className="size-3 shrink-0" />
    ),
  };
}
