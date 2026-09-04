/** Owned by the header lane of M-197 (plan §7). Header actions, banners, and the overlays that wrap ChatView for a plan line. */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { MemoryNote, PlanId } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import type { DraftId } from "../../composerDraftStore";
import { useThread } from "../../state/entities";
import { useMercurianTree, usePlanDetail } from "../../state/mercurian";
import { useReadMemoryNote } from "../../state/mercurianMemory";
import type { ThreadSyncPhase } from "../../threadSync";
import type { ChatMessage } from "../../types";
import ChatView from "../ChatView";
import type { ChatComposerMentionSources } from "../chat/ChatComposer";
import type { ThreadActionMenuId } from "../threadActionMenu.logic";
import { Button } from "../ui/button";
import { LineBranchMissingBanner } from "./LineBranchMissingBanner";
import { MemoryAmendmentSheet } from "./MemoryAmendmentSheet";
import { MemoryNoteReader } from "./MemoryNoteReader";
import { NarrowedGroundingNotice } from "./NarrowedGroundingNotice";
import { usePlanMentionCandidates } from "./PlanMentionSources";
import { formatMentionCandidate } from "./planMentions.logic";
import {
  memoryAmendmentFailureNotice,
  resolveForkHereInput,
  resolveLineInFlightTurn,
} from "./ThreadSpaceChrome.logic";
import { useThreadSpace } from "./ThreadSpaceContext";
import { useThreadSpaceSurfaces } from "./ThreadSpaceSurfaces";
import { resolveLineTip } from "./planLineOwnership.logic";
import { useForkHere } from "./useForkHere";

export type ThreadSpaceChatViewChrome = Readonly<{
  headerBanner?: ReactNode;
  headerProjectName?: string;
  hiddenThreadMenuActions?: ReadonlySet<ThreadActionMenuId>;
  workspaceReady?: boolean;
  workspaceCwdOverride?: string | null;
  mentionSources?: ChatComposerMentionSources;
  canForkHere?: (message: ChatMessage) => boolean;
  onForkHere?: (message: ChatMessage) => void;
}>;

const MERCURIAN_HIDDEN_THREAD_MENU_ACTIONS: ReadonlySet<ThreadActionMenuId> = new Set([
  "new-thread-on-branch",
  "pin",
  "unpin",
  "settle",
  "unsettle",
  "snooze",
  "unsnooze",
  "archive",
  "delete",
]);

export type ThreadSpaceChrome = Readonly<{
  chatView: ThreadSpaceChatViewChrome;
  overlays?: ReactNode;
}>;

type ThreadSpaceViewProps =
  | Readonly<{ routeKind: "server"; threadSyncPhase: ThreadSyncPhase | null }>
  | Readonly<{ routeKind: "draft"; draftId: DraftId }>;

export function ThreadSpaceView(props: ThreadSpaceViewProps) {
  const { environmentId, threadId } = useThreadSpace();
  const surfaces = useThreadSpaceSurfaces();
  const chrome = useThreadSpaceChrome();

  return (
    <>
      {props.routeKind === "server" ? (
        <ChatView
          environmentId={environmentId}
          threadId={threadId}
          routeKind="server"
          threadSyncPhase={props.threadSyncPhase}
          {...surfaces}
          {...chrome.chatView}
        />
      ) : (
        <ChatView
          draftId={props.draftId}
          environmentId={environmentId}
          threadId={threadId}
          routeKind="draft"
          forceExpandedMobileComposer
          {...surfaces}
          {...chrome.chatView}
        />
      )}
      {chrome.overlays}
    </>
  );
}

export function SlotWaitNotice() {
  return (
    <div
      role="status"
      className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      Waiting for a working slot…
    </div>
  );
}

export function useThreadSpaceChrome(): ThreadSpaceChrome {
  const { detail, environmentId, graph, planId, projectId, threadId } = useThreadSpace();
  const thread = useThread(scopeThreadRef(environmentId, threadId));
  const { snapshot: treeSnapshot } = useMercurianTree();
  const headerProjectName = treeSnapshot.projects.find(
    (project) => project.projectId === projectId,
  )?.name;
  const runtime = detail?.lineRuntimes.find((candidate) => candidate.threadId === threadId) ?? null;
  const inFlightTurn = resolveLineInFlightTurn(
    detail,
    graph,
    runtime,
    treeSnapshot.threadPlanLinks,
  );
  const lineTip = resolveLineTip(detail, graph, runtime, treeSnapshot.threadPlanLinks);
  const workspaceReady =
    planId !== null &&
    Boolean(thread && (thread.workspaceMembers != null || thread.worktreePath !== null));
  const workspaceCwdOverride = planId === null ? null : thread?.worktreePath;
  const forkHere = useForkHere();
  const canForkHere = useCallback(
    (message: ChatMessage) => resolveForkHereInput(graph, message) !== null,
    [graph],
  );
  const onForkHere = useCallback(
    (message: ChatMessage) => {
      const input = resolveForkHereInput(graph, message);
      if (input !== null) void forkHere(input);
    },
    [forkHere, graph],
  );
  const mentions = usePlanMentionCandidates(projectId);
  const memoryMentionCandidates = mentions.candidates;
  const memoryMentionSources = mentions.sources;
  const onMentionQueryChange = mentions.onMentionQueryChange;
  const onMemoryMentionQueryChange = useCallback(
    (query: string | null) => onMentionQueryChange(query, { notesOnly: true }),
    [onMentionQueryChange],
  );
  const mentionSources = useMemo<ChatComposerMentionSources>(
    () => ({
      candidates: memoryMentionCandidates
        .filter((candidate) => candidate.kind === "note")
        .map((candidate) => ({
          id: candidate.key,
          path: candidate.name,
          pathKind: "file",
          label: candidate.label,
          description: "Memory note",
          replacement: formatMentionCandidate(candidate),
        })),
      sources: memoryMentionSources,
      onQueryChange: onMemoryMentionQueryChange,
    }),
    [memoryMentionCandidates, memoryMentionSources, onMemoryMentionQueryChange],
  );

  return {
    chatView: {
      ...(planId === null
        ? {}
        : {
            headerBanner: (
              <>
                <LineBranchMissingBanner
                  threadId={threadId}
                  branch={runtime?.branch ?? thread?.branch ?? null}
                  lineBranchMissingOid={runtime?.lineBranchMissingOid ?? null}
                />
                {inFlightTurn?.phase === "waiting-for-slot" ? <SlotWaitNotice /> : null}
                {inFlightTurn?.groundingScope === undefined ? null : (
                  <div className="border-b border-border bg-muted/20 px-3 py-1.5">
                    <NarrowedGroundingNotice scope={inFlightTurn.groundingScope} />
                  </div>
                )}
              </>
            ),
          }),
      ...(headerProjectName === undefined ? {} : { headerProjectName }),
      hiddenThreadMenuActions: MERCURIAN_HIDDEN_THREAD_MENU_ACTIONS,
      workspaceReady,
      ...(workspaceCwdOverride === undefined ? {} : { workspaceCwdOverride }),
      mentionSources,
      ...(planId === null ? {} : { canForkHere, onForkHere }),
    },
    ...(planId === null
      ? {}
      : {
          overlays: (
            <ThreadSpaceMemoryOverlays
              key={planId}
              lineTip={lineTip}
              planId={planId}
              turnActive={inFlightTurn !== undefined}
            />
          ),
        }),
  };
}

function ThreadSpaceMemoryOverlays(props: {
  readonly lineTip: ReturnType<typeof resolveLineTip>;
  readonly planId: PlanId;
  readonly turnActive: boolean;
}) {
  const { detail } = useThreadSpace();
  const { memoryAmendmentFailure } = usePlanDetail(props.planId);
  const readMemoryNote = useReadMemoryNote();
  const [closedMemoryAmendmentTurnId, setClosedMemoryAmendmentTurnId] = useState<string | null>(
    null,
  );
  const [dismissedMemoryFailure, setDismissedMemoryFailure] = useState<string | null>(null);
  const [memoryReader, setMemoryReader] = useState<{ readonly stack: string[] }>({ stack: [] });
  const [loadedMemoryNote, setLoadedMemoryNote] = useState<{
    readonly name: string;
    readonly note: MemoryNote | null;
    readonly error: string | null;
  } | null>(null);
  const memoryAmendmentProposal = detail?.memoryAmendmentProposal;
  const memoryAmendmentSheetOpen =
    memoryAmendmentProposal !== undefined &&
    memoryAmendmentProposal.turnId !== closedMemoryAmendmentTurnId;
  const currentMemoryNoteName = memoryReader.stack.at(-1) ?? null;
  const currentMemoryNote =
    loadedMemoryNote?.name === currentMemoryNoteName ? loadedMemoryNote : null;
  const openMemoryNote = useCallback((name: string) => {
    setMemoryReader((current) => ({ stack: [...current.stack, name] }));
  }, []);

  useEffect(() => {
    const projectId = detail?.plan.projectId;
    if (currentMemoryNoteName === null || projectId === undefined) return;
    let active = true;
    void readMemoryNote({ projectId, name: currentMemoryNoteName }).then((result) => {
      if (!active) return;
      setLoadedMemoryNote({
        name: currentMemoryNoteName,
        note: result.ok ? result.value : null,
        error: result.ok ? null : memoryReadError(result.error),
      });
    });
    return () => {
      active = false;
    };
  }, [currentMemoryNoteName, detail?.plan.projectId, readMemoryNote]);

  useEffect(() => {
    if (currentMemoryNoteName === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMemoryReader({ stack: [] });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentMemoryNoteName]);

  const memoryFailureKey =
    memoryAmendmentFailure === null
      ? null
      : `${memoryAmendmentFailure.turnId}\0${memoryAmendmentFailure.reason}`;
  const failureNotice =
    memoryAmendmentFailure === null || memoryFailureKey === dismissedMemoryFailure
      ? null
      : memoryAmendmentFailureNotice(memoryAmendmentFailure);

  return (
    <>
      {failureNotice === null ? null : (
        <div className="absolute inset-x-0 top-[var(--workspace-topbar-height)] z-30 px-3 pt-2 sm:px-5">
          <div
            role="alert"
            className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-lg border border-destructive/30 bg-background px-3 py-2 text-xs text-destructive-foreground shadow-sm"
          >
            <span className="min-w-0 flex-1">{failureNotice}</span>
            <Button
              aria-label="Dismiss memory amendment failure"
              size="icon-xs"
              type="button"
              variant="ghost"
              onClick={() => setDismissedMemoryFailure(memoryFailureKey)}
            >
              <XIcon aria-hidden className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
      {currentMemoryNoteName === null ? null : (
        <div className="absolute inset-y-0 right-0 z-40 max-w-full shadow-lg">
          <MemoryNoteReader
            error={currentMemoryNote?.error ?? null}
            loading={currentMemoryNote === null}
            note={currentMemoryNote?.note ?? null}
            onOpenNote={openMemoryNote}
            onClose={() => setMemoryReader({ stack: [] })}
            {...(memoryReader.stack.length > 1
              ? {
                  onBack: () =>
                    setMemoryReader((current) => ({ stack: current.stack.slice(0, -1) })),
                }
              : {})}
          />
        </div>
      )}
      {memoryAmendmentProposal === undefined ? null : (
        <MemoryAmendmentSheet
          onOpenChange={(open) => {
            if (!open) setClosedMemoryAmendmentTurnId(memoryAmendmentProposal.turnId);
          }}
          open={memoryAmendmentSheetOpen}
          parentCommitId={props.lineTip}
          planId={props.planId}
          proposal={memoryAmendmentProposal}
          turnActive={props.turnActive}
        />
      )}
    </>
  );
}

function memoryReadError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not read this memory note.";
}
