import { useAtomValue } from "@effect/atom-react";
import {
  AuthTerminalOperateScope,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabelsCopy";
import { useMessages } from "gt-react";
import { memo, useEffect } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStableCallback } from "../hooks/useStableCallback";
import type { TerminalContextSelection } from "../lib/terminalContext";
import { focusActiveDrawerTerminal, focusTerminal } from "../lib/terminalFocus";
import { shortcutLabelForCommand } from "../keybindings";
import { chatBridgeOf, useChatBridgeStore } from "../panes/chatBridge";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";
import { useProject, useQuietThreadShell } from "../state/entities";
import { chatTabKey } from "../sectionTabs/sectionTabs";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { useKnownTerminalSessions } from "../state/terminalSessions";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useThreadTerminalActions } from "./terminal/useThreadTerminalActions";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import { resolveTerminalWorktreePath } from "./ChatView.logic";

/** Where a terminal tab or panel opens new terminals when a script run overrides the thread's own. */
export type PersistentTerminalLaunchContext = {
  readonly cwd: string;
  readonly worktreePath: string | null;
};

function terminalIdListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  if (left.length === 0) {
    return true;
  }
  const sortedLeft = left.toSorted((a, b) => a.localeCompare(b));
  const sortedRight = right.toSorted((a, b) => a.localeCompare(b));
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (sortedLeft[index] !== sortedRight[index]) {
      return false;
    }
  }
  return true;
}

/** Server sessions lag terminal.open; reconciling strict subsets would discard new split layouts. */
function serverTerminalIdsStrictSubsetOfClient(
  serverIds: readonly string[],
  clientIds: readonly string[],
): boolean {
  if (serverIds.length >= clientIds.length || clientIds.length === 0) {
    return false;
  }
  const clientSet = new Set(clientIds);
  for (const id of serverIds) {
    if (!clientSet.has(id)) {
      return false;
    }
  }
  return true;
}

interface TerminalLaunchLocationWithEnv {
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly runtimeEnv: Record<string, string>;
}

/**
 * Astrolabe: a thread's terminal tab in the shared panes. It renders on its own rather than through
 * ChatView, so it stays alive set aside, behind other tabs, and through its chat's `Activity`.
 * What only the chat can reach comes through `chatBridge`.
 */
export const PersistentThreadTerminalTab = memo(function PersistentThreadTerminalTab({
  threadRef,
  visible,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
}) {
  const { threadId } = threadRef;
  const chatKey = chatTabKey(threadRef);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const launchContext = useChatBridgeStore(
    (state) => state.byChatKey[chatKey]?.launchContext ?? null,
  );
  const shortcutOptions = { context: { terminalFocus: true, terminalOpen: true } };
  const splitShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.split",
    shortcutOptions,
  );
  const splitVerticalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.splitVertical",
    shortcutOptions,
  );
  const newShortcutLabel = shortcutLabelForCommand(keybindings, "terminal.new", shortcutOptions);
  const closeShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.close",
    shortcutOptions,
  );
  const canOperateTerminal = useEnvironmentScope(threadRef.environmentId, AuthTerminalOperateScope);
  const terminalActions = useThreadTerminalActions(threadRef);
  const serverThread = useQuietThreadShell(threadRef);
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef),
  );
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId,
  });
  const messages = useMessages();
  const panelSurfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );
  const panelTerminalIds = new Set(
    panelSurfaces.flatMap((surface) => (surface.kind === "terminal" ? surface.terminalIds : [])),
  );
  const drawerTerminalSessions =
    knownTerminalSessions?.filter((session) => !panelTerminalIds.has(session.target.terminalId)) ??
    [];
  const terminalLabelsById = new Map<string, string>();
  for (const session of drawerTerminalSessions) {
    terminalLabelsById.set(
      session.target.terminalId,
      resolveTerminalSessionLabel(session.target.terminalId, session.state.summary, messages),
    );
  }
  const terminalLaunchLocationsById = new Map<string, TerminalLaunchLocationWithEnv>();
  for (const session of drawerTerminalSessions) {
    const summary = session.state.summary;
    if (!project || !summary) continue;
    const worktreePathForLaunch =
      launchContext !== null ? launchContext.worktreePath : summary.worktreePath;
    terminalLaunchLocationsById.set(session.target.terminalId, {
      cwd: launchContext?.cwd ?? summary.cwd,
      worktreePath: worktreePathForLaunch,
      runtimeEnv: projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath: worktreePathForLaunch,
      }),
    });
  }
  const serverOrderedTerminalIds = drawerTerminalSessions.map(
    (session) => session.target.terminalId,
  );
  const storeSplitTerminal = useTerminalUiStateStore((state) => state.splitTerminal);
  const storeSplitTerminalVertical = useTerminalUiStateStore(
    (state) => state.splitTerminalVertical,
  );
  const storeNewTerminal = useTerminalUiStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalUiStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalUiStateStore((state) => state.closeTerminal);
  const reconcileTerminalIds = useTerminalUiStateStore((state) => state.reconcileTerminalIds);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles the terminal UI store's ids with the server's terminal list when they diverge
  useEffect(() => {
    if (terminalIdListsEqual(serverOrderedTerminalIds, terminalUiState.terminalIds)) {
      return;
    }
    if (
      serverTerminalIdsStrictSubsetOfClient(serverOrderedTerminalIds, terminalUiState.terminalIds)
    ) {
      return;
    }
    reconcileTerminalIds(threadRef, serverOrderedTerminalIds);
  }, [reconcileTerminalIds, serverOrderedTerminalIds, terminalUiState.terminalIds, threadRef]);
  const worktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveWorktreePath = launchContext !== null ? launchContext.worktreePath : worktreePath;
  const cwd =
    launchContext?.cwd ??
    (project
      ? projectScriptCwd({
          project: { cwd: project.workspaceRoot },
          worktreePath: effectiveWorktreePath,
        })
      : null);
  const runtimeEnv = project
    ? projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath: effectiveWorktreePath,
      })
    : {};

  const launchDrawerTerminal = (place: (terminalId: string) => void) => {
    if (!cwd) return;
    const launched = terminalActions.launchTerminal({
      place,
      location: { cwd, worktreePath: effectiveWorktreePath },
    });
    if (!launched) return;
    if (visible) focusTerminal(threadRef, launched.terminalId);
    void launched.result;
  };
  const splitTerminal = useStableCallback(() =>
    launchDrawerTerminal((terminalId) => storeSplitTerminal(threadRef, terminalId)),
  );
  const splitTerminalVertical = useStableCallback(() =>
    launchDrawerTerminal((terminalId) => storeSplitTerminalVertical(threadRef, terminalId)),
  );
  const createNewTerminal = useStableCallback(() =>
    launchDrawerTerminal((terminalId) => storeNewTerminal(threadRef, terminalId)),
  );

  const activateTerminal = (terminalId: string) => {
    storeSetActiveTerminal(threadRef, terminalId);
    if (visible) focusTerminal(threadRef, terminalId);
  };

  const closeTerminal = useStableCallback((terminalId: string) => {
    if (!terminalActions.canWrite()) return;
    terminalActions.closeTerminalSession(terminalId);
    storeCloseTerminal(threadRef, terminalId);
    if (visible) focusActiveDrawerTerminal(threadRef);
  });

  const handleAddTerminalContext = (selection: TerminalContextSelection) => {
    if (!visible) {
      return;
    }
    chatBridgeOf(chatKey)?.addTerminalContext(selection);
  };

  if (!project || !cwd) {
    return null;
  }

  return (
    <ThreadTerminalDrawer
      threadRef={threadRef}
      threadId={threadId}
      cwd={cwd}
      worktreePath={effectiveWorktreePath}
      runtimeEnv={runtimeEnv}
      visible={visible}
      // Known-session order is MRU and changes on focus; persisted store order keeps sidebar labels stable.
      terminalIds={canOperateTerminal ? terminalUiState.terminalIds : serverOrderedTerminalIds}
      activeTerminalId={terminalUiState.activeTerminalId}
      terminalGroups={terminalUiState.terminalGroups}
      activeTerminalGroupId={terminalUiState.activeTerminalGroupId}
      onSplitTerminal={splitTerminal}
      onSplitTerminalVertical={splitTerminalVertical}
      onNewTerminal={createNewTerminal}
      splitShortcutLabel={visible ? (splitShortcutLabel ?? undefined) : undefined}
      splitVerticalShortcutLabel={visible ? (splitVerticalShortcutLabel ?? undefined) : undefined}
      newShortcutLabel={visible ? (newShortcutLabel ?? undefined) : undefined}
      closeShortcutLabel={visible ? (closeShortcutLabel ?? undefined) : undefined}
      keybindings={keybindings}
      onActiveTerminalChange={activateTerminal}
      onCloseTerminal={closeTerminal}
      onAddTerminalContext={handleAddTerminalContext}
      terminalLabelsById={terminalLabelsById}
      terminalLaunchLocationsById={terminalLaunchLocationsById}
    />
  );
});

export interface PersistentThreadTerminalPanelProps {
  visible: boolean;
  threadRef: ScopedThreadRef;
  surface: Extract<RightPanelSurface, { kind: "terminal" }>;
  launchContext: PersistentTerminalLaunchContext | null;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  onSplitTerminal: () => void;
  onSplitTerminalVertical: () => void;
  onNewTerminal: () => void;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string, threadRef?: ScopedThreadRef) => void;
  splitShortcutLabel?: string | undefined;
  splitVerticalShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
}

export const PersistentThreadTerminalPanel = memo(function PersistentThreadTerminalPanel({
  visible,
  threadRef,
  surface,
  launchContext,
  keybindings,
  onAddTerminalContext,
  onSplitTerminal,
  onSplitTerminalVertical,
  onNewTerminal,
  onActiveTerminalChange,
  onCloseTerminal,
  splitShortcutLabel,
  splitVerticalShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
}: PersistentThreadTerminalPanelProps) {
  const messages = useMessages();
  const serverThread = useQuietThreadShell(threadRef);
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
  });
  const threadWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const activeSummary =
    knownTerminalSessions?.find((session) => session.target.terminalId === surface.activeTerminalId)
      ?.state.summary ?? null;
  const worktreePath = resolveTerminalWorktreePath({
    launchContext,
    summary: activeSummary,
    threadWorktreePath,
  });
  const cwd =
    launchContext?.cwd ??
    activeSummary?.cwd ??
    (project ? projectScriptCwd({ project: { cwd: project.workspaceRoot }, worktreePath }) : null);
  const runtimeEnv = project
    ? projectScriptRuntimeEnv({ project: { cwd: project.workspaceRoot }, worktreePath })
    : {};
  const terminalLabelsById = new Map<string, string>();
  const terminalLaunchLocationsById = new Map<string, TerminalLaunchLocationWithEnv>();
  for (const terminalId of surface.terminalIds) {
    const summary =
      knownTerminalSessions?.find((session) => session.target.terminalId === terminalId)?.state
        .summary ?? null;
    terminalLabelsById.set(terminalId, resolveTerminalSessionLabel(terminalId, summary, messages));
    if (!project) continue;
    const terminalWorktreePath = resolveTerminalWorktreePath({
      launchContext,
      summary,
      threadWorktreePath,
    });
    terminalLaunchLocationsById.set(terminalId, {
      cwd:
        launchContext?.cwd ??
        summary?.cwd ??
        projectScriptCwd({
          project: { cwd: project.workspaceRoot },
          worktreePath: terminalWorktreePath,
        }),
      worktreePath: terminalWorktreePath,
      runtimeEnv: projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath: terminalWorktreePath,
      }),
    });
  }

  if (!project || !cwd) return null;

  return (
    <ThreadTerminalDrawer
      mode="panel"
      visible={visible}
      threadRef={threadRef}
      threadId={threadRef.threadId}
      cwd={cwd}
      worktreePath={worktreePath}
      runtimeEnv={runtimeEnv}
      terminalIds={surface.terminalIds}
      activeTerminalId={surface.activeTerminalId}
      terminalGroups={[
        {
          id: surface.id,
          terminalIds: surface.terminalIds,
          ...(surface.splitDirection === "vertical" ? { splitDirection: "vertical" as const } : {}),
        },
      ]}
      activeTerminalGroupId={surface.id}
      onSplitTerminal={onSplitTerminal}
      onSplitTerminalVertical={onSplitTerminalVertical}
      onNewTerminal={onNewTerminal}
      splitShortcutLabel={splitShortcutLabel}
      splitVerticalShortcutLabel={splitVerticalShortcutLabel}
      newShortcutLabel={newShortcutLabel}
      closeShortcutLabel={closeShortcutLabel}
      onActiveTerminalChange={onActiveTerminalChange}
      onCloseTerminal={onCloseTerminal}
      onAddTerminalContext={onAddTerminalContext}
      terminalLabelsById={terminalLabelsById}
      terminalLaunchLocationsById={terminalLaunchLocationsById}
      keybindings={keybindings}
    />
  );
});
