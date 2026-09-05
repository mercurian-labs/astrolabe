import type {
  EnvironmentId,
  MemoryAmendmentSummary,
  MemoryCatalog,
  MemoryChangedDocument,
  MemoryComparisonTarget,
  MemoryDocumentTarget,
  MemoryReadingPosition,
  MemoryUnavailable,
  MercurianProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileDiffIcon,
  FileTextIcon,
  MapIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useDiffPanelStore } from "../../diffPanelStore";
import {
  selectMemoryGraphOpen,
  selectMemorySelection,
  useMemoryPanelStore,
  type MemorySelection,
} from "../../memoryPanelStore";
import { useRightPanelStore } from "../../rightPanelStore";
import {
  useMarkMemoryChangeReviewed,
  useMergeMemoryHome,
  useReadMemoryCatalog,
  useRevertMemoryChange,
} from "../../state/mercurianMemory";
import { cn } from "../../lib/utils";
import { WORKSPACE_PANE_TITLE_BAR_CLASS } from "../../workspaceTitlebar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { ManageProjectRepositoriesDialog } from "./ManageProjectRepositoriesDialog";
import { MemoryLocalGraph } from "./MemoryLocalGraph";
import {
  appendToDraftPrompt,
  createMemoryRequestGate,
  isHistoricalMemoryPosition,
  memoryAmendmentAttribution,
  memoryBrowseEntries,
  memoryComparisonLabel,
  memoryCurationRefusal,
  memoryDocumentKindLabel,
  memoryDocumentName,
  memoryDocumentStatusLabel,
  memoryChangesSummary,
  memoryDocumentTargetForCatalogEntry,
  memoryGraphEmptyCopy,
  memoryLimitationCopy,
  memoryMergeConfirmInput,
  memoryMergeHomeOutcomeCopy,
  memoryMergeHomeReconciliationMessage,
  memoryMergeReviewIsConfirmable,
  memoryMergeStateCopy,
  memoryMergeTransition,
  memoryNeedsReview,
  memoryNoteRequestScope,
  memoryPositionNotice,
  memoryRequestScope,
  memoryRevertInvestigationMessage,
  memorySelectionHighlight,
  memoryTabRevertTarget,
  memoryUnavailableCopy,
  resolveMemoryNoteSelection,
  type MemoryAvailableDashboard,
  type MemoryCurationRefusal,
  type MemoryDashboardState,
  type MemoryMergeState,
} from "./MemoryTab.logic";

export type MemoryBrowseState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly catalog: MemoryCatalog }
  | { readonly kind: "error"; readonly message: string };

export interface MemoryTabViewProps {
  readonly state: MemoryDashboardState;
  readonly reading: MemoryReadingPosition;
  readonly activeTurn: boolean;
  readonly selection: MemorySelection | null;
  readonly onSelect: (selection: MemorySelection | null) => void;
  readonly graphOpen: boolean;
  readonly onGraphOpenChange: (open: boolean) => void;
  readonly browse: MemoryBrowseState;
  readonly onBrowse: () => void;
  readonly merge: MemoryMergeState;
  readonly onPrepareMerge: () => void;
  readonly onConfirmMerge: () => void;
  readonly onDismissMerge: () => void;
  readonly onMarkReviewed: (amendmentId: string) => Promise<MemoryCurationRefusal | null>;
  readonly onRevert: (amendment: MemoryAmendmentSummary) => Promise<MemoryCurationRefusal | null>;
  readonly onOpenDocument: (target: MemoryDocumentTarget) => void;
  readonly onViewChanges: (target: MemoryComparisonTarget, label: string) => void;
  readonly onAppendDraft: (text: string) => void;
  readonly onReturnToLatest?: (() => void) | undefined;
  readonly onOpenSettings?: (() => void) | undefined;
  readonly notice?: string | null | undefined;
  readonly cornerControl?: ReactNode;
}

export function MemoryTab({
  environmentId,
  threadRef,
  projectId,
  projectName,
  state,
  reading,
  activeTurn,
  invalidationTick,
  refresh,
  onReturnToLatest,
  cornerControl,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly projectId: MercurianProjectId | null;
  readonly projectName: string;
  readonly state: MemoryDashboardState;
  readonly reading: MemoryReadingPosition;
  readonly activeTurn: boolean;
  readonly invalidationTick: number;
  readonly refresh: () => Promise<void>;
  readonly onReturnToLatest?: (() => void) | undefined;
  readonly cornerControl?: ReactNode;
}) {
  const line = useMemo(() => ({ threadId: threadRef.threadId }), [threadRef.threadId]);
  const markReviewed = useMarkMemoryChangeReviewed(environmentId);
  const revertChange = useRevertMemoryChange(environmentId);
  const mergeHome = useMergeMemoryHome(environmentId);
  const readCatalog = useReadMemoryCatalog(environmentId);
  const selection = useMemoryPanelStore((store) =>
    selectMemorySelection(store.selectionByThreadKey, threadRef),
  );
  const graphOpen = useMemoryPanelStore((store) =>
    selectMemoryGraphOpen(store.graphOpenByThreadKey, threadRef),
  );
  const select = useCallback(
    (next: MemorySelection | null) => useMemoryPanelStore.getState().select(threadRef, next),
    [threadRef],
  );
  const setGraphOpen = useCallback(
    (open: boolean) => useMemoryPanelStore.getState().setGraphOpen(threadRef, open),
    [threadRef],
  );
  const [mergeState, setMerge] = useState<MemoryMergeState>({ kind: "idle" });
  // Browse and the note notice belong to one scope: environment, line, and reading
  // position. Another scope reads them as idle without any reset effect.
  const scope = memoryRequestScope({ environmentId, threadId: threadRef.threadId, reading });
  const [browseState, setBrowseState] = useState<{
    readonly scope: string;
    readonly tick: number;
    readonly value: MemoryBrowseState;
  } | null>(null);
  const [noticeState, setNoticeState] = useState<{
    readonly scope: string;
    readonly value: string;
  } | null>(null);
  const browse: MemoryBrowseState =
    browseState?.scope === scope && browseState.tick === invalidationTick
      ? browseState.value
      : { kind: "idle" };
  const notice = noticeState?.scope === scope ? noticeState.value : null;
  const [manageOpen, setManageOpen] = useState(false);
  const dashboard =
    state.kind === "ready" && state.dashboard.kind === "available" ? state.dashboard : null;
  const historical = isHistoricalMemoryPosition(reading);
  const liveScope = useRef(scope);
  useEffect(() => {
    liveScope.current = scope;
  }, [scope]);

  const lastInvalidation = useRef(invalidationTick);
  useEffect(() => {
    if (lastInvalidation.current === invalidationTick) return;
    lastInvalidation.current = invalidationTick;
    setMerge((current) => memoryMergeTransition(current, { kind: "invalidated" }));
  }, [invalidationTick]);
  // A deferred approval follows the live dashboard's curation version, derived in render so
  // the panel never shows an approval the current dashboard has already retired. History
  // reads are left out: a checkpoint carries its own version and is not a memory change.
  const liveVersion = historical ? null : (dashboard?.curationVersion ?? null);
  const merge =
    liveVersion === null
      ? mergeState
      : memoryMergeTransition(mergeState, { kind: "dashboard", version: liveVersion });
  if (merge !== mergeState) setMerge(merge);

  const openDocument = useCallback(
    (target: MemoryDocumentTarget) =>
      useRightPanelStore.getState().openMemoryDocument(threadRef, { environmentId, target }),
    [environmentId, threadRef],
  );
  const viewChanges = useCallback(
    (target: MemoryComparisonTarget, label: string) => {
      useDiffPanelStore
        .getState()
        .selectMemoryComparison(threadRef, { environmentId, target }, label);
      useRightPanelStore.getState().open(threadRef, "diff");
    },
    [environmentId, threadRef],
  );
  const appendDraft = useCallback(
    (text: string) => {
      const drafts = useComposerDraftStore.getState();
      drafts.setPrompt(
        threadRef,
        appendToDraftPrompt(drafts.getComposerDraft(threadRef)?.prompt ?? "", text),
      );
    },
    [threadRef],
  );
  // Browse is issued for the live scope; a late answer for another position, line,
  // or environment settles nothing, and a newer Browse supersedes an older one.
  const browseRequests = useRef(createMemoryRequestGate());
  const loadCatalog = useCallback(async () => {
    if (dashboard === null) return;
    const token = browseRequests.current.begin(scope);
    const tick = invalidationTick;
    setBrowseState({ scope, tick, value: { kind: "loading" } });
    const outcome = await readCatalog({ position: dashboard.position });
    if (!browseRequests.current.settles(token, liveScope.current)) return;
    setBrowseState({
      scope,
      tick,
      value: outcome.ok
        ? { kind: "ready", catalog: outcome.value }
        : {
            kind: "error",
            message:
              outcome.error instanceof Error
                ? outcome.error.message
                : "Could not list memory files.",
          },
    });
  }, [dashboard, invalidationTick, readCatalog, scope]);

  // A note addressed by name resolves to the changed document that carries it.
  useEffect(() => {
    if (selection?.kind !== "note" || dashboard === null) return;
    const document = resolveMemoryNoteSelection(dashboard, selection.name);
    if (document !== null) select({ kind: "document", id: document.id });
  }, [dashboard, select, selection]);

  // An unchanged note opens its captured version in Files instead of pretending to be a
  // change. The lookup is bound to the selection and scope that asked: changing either
  // cancels it, and a late answer neither opens Files nor touches the notice or selection.
  const noteScope = memoryNoteRequestScope(scope, selection);
  const unresolvedNote =
    selection?.kind === "note" &&
    dashboard !== null &&
    resolveMemoryNoteSelection(dashboard, selection.name) === null
      ? selection.name
      : null;
  const noteRequests = useRef(createMemoryRequestGate());
  const liveNoteScope = useRef(noteScope);
  useEffect(() => {
    liveNoteScope.current = noteScope;
  }, [noteScope]);
  const dashboardPosition = dashboard?.position ?? null;
  useEffect(() => {
    if (noteScope === null || unresolvedNote === null || dashboardPosition === null) return;
    const name = unresolvedNote;
    const token = noteRequests.current.begin(noteScope);
    let cancelled = false;
    void readCatalog({ position: dashboardPosition }).then((outcome) => {
      if (cancelled || !noteRequests.current.settles(token, liveNoteScope.current)) return;
      const wanted = name.toLocaleLowerCase();
      const available = outcome.ok && outcome.value.kind === "available" ? outcome.value : null;
      const entry = available?.entries.find(
        (candidate) => memoryDocumentName(candidate.path).toLocaleLowerCase() === wanted,
      );
      if (available === null || entry === undefined) {
        setNoticeState({ scope, value: `"${name}" is not written at this position.` });
      } else {
        setNoticeState({
          scope,
          value: `"${name}" is unchanged on this line; its current version is open in Files.`,
        });
        openDocument(memoryDocumentTargetForCatalogEntry(available.position, entry));
      }
      select(null);
    });
    return () => {
      cancelled = true;
    };
  }, [dashboardPosition, noteScope, openDocument, readCatalog, scope, select, unresolvedNote]);

  const settle = useCallback(
    async (
      act: "review" | "revert",
      run: () => Promise<{ ok: true } | { ok: false; error: unknown }>,
    ) => {
      if (historical) return { message: "Return to the latest position before curating memory." };
      const outcome = await run();
      if (!outcome.ok) {
        const refusal = memoryCurationRefusal(outcome.error, act);
        // A stale version means the person acted on an older dashboard: show the current one
        // and wait for a new explicit click. Nothing is resubmitted here.
        if (refusal.reason === "stale-review") await refresh();
        return refusal;
      }
      setMerge((current) => memoryMergeTransition(current, { kind: "invalidated" }));
      await refresh();
      return null;
    },
    [historical, refresh],
  );
  const onMarkReviewed = useCallback(
    (amendmentId: string) => settle("review", () => markReviewed({ line, commitOid: amendmentId })),
    [line, markReviewed, settle],
  );
  // Both revert targets are bound to the version of the dashboard the person is looking at,
  // never to a version fetched after the click; a mismatch is a stale-review refusal.
  const curationVersion = dashboard?.curationVersion ?? null;
  const onRevert = useCallback(
    (amendment: MemoryAmendmentSummary) =>
      settle("revert", async () =>
        curationVersion === null
          ? { ok: false, error: new Error("The dashboard is not available to revert against.") }
          : revertChange({
              line,
              target: memoryTabRevertTarget(amendment),
              expectedVersion: curationVersion,
            }),
      ),
    [curationVersion, line, revertChange, settle],
  );
  const runMerge = useCallback(
    async (step: "prepare" | "confirm") => {
      if (step === "confirm" && !memoryMergeReviewIsConfirmable(merge)) return;
      const confirm =
        step === "confirm" && merge.kind === "review"
          ? memoryMergeConfirmInput(merge.review)
          : null;
      setMerge((current) => memoryMergeTransition(current, { kind: "start", step }));
      const outcome = await mergeHome({ line, ...confirm });
      if (!outcome.ok) {
        setMerge((current) =>
          memoryMergeTransition(current, {
            kind: "failure",
            message: memoryCurationRefusal(outcome.error, "merge").message,
          }),
        );
        return;
      }
      setMerge((current) =>
        memoryMergeTransition(current, {
          kind: "result",
          result: outcome.value,
          version: curationVersion,
        }),
      );
      if (outcome.value.kind === "merged" || outcome.value.kind === "deferred-to-push") {
        await refresh();
      }
    },
    [curationVersion, line, merge, mergeHome, refresh],
  );

  return (
    <>
      <MemoryTabView
        activeTurn={activeTurn}
        browse={browse}
        graphOpen={graphOpen}
        merge={merge}
        notice={notice}
        reading={reading}
        selection={selection}
        state={state}
        onAppendDraft={appendDraft}
        onBrowse={() => void loadCatalog()}
        onConfirmMerge={() => void runMerge("confirm")}
        onDismissMerge={() => setMerge({ kind: "idle" })}
        onGraphOpenChange={setGraphOpen}
        onMarkReviewed={onMarkReviewed}
        onOpenDocument={openDocument}
        onOpenSettings={projectId === null ? undefined : () => setManageOpen(true)}
        onPrepareMerge={() => void runMerge("prepare")}
        onRevert={onRevert}
        onReturnToLatest={onReturnToLatest}
        onSelect={select}
        onViewChanges={viewChanges}
        {...(cornerControl === undefined ? {} : { cornerControl })}
      />
      {projectId === null ? null : (
        <ManageProjectRepositoriesDialog
          open={manageOpen}
          projectId={projectId}
          projectName={projectName}
          onOpenChange={setManageOpen}
        />
      )}
    </>
  );
}

export function MemoryTabView(props: MemoryTabViewProps) {
  const { state, reading, merge, cornerControl } = props;
  const historical = isHistoricalMemoryPosition(reading);
  const dashboard =
    state.kind === "ready" && state.dashboard.kind === "available" ? state.dashboard : null;
  const canMerge = dashboard !== null && !historical && merge.kind !== "busy";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`${WORKSPACE_PANE_TITLE_BAR_CLASS} gap-2 border-b border-border px-3 sm:px-4`}
      >
        <h2 className="text-sm font-medium">Memory</h2>
        {dashboard !== null && dashboard.unreviewedCount > 0 ? (
          <Badge
            size="sm"
            variant="warning"
            aria-label={`${dashboard.unreviewedCount} changes need review`}
          >
            {dashboard.unreviewedCount}
          </Badge>
        ) : null}
        <span className="min-w-0 flex-1" />
        {dashboard === null ? null : (
          <Button
            disabled={!canMerge}
            size="sm"
            type="button"
            variant="secondary"
            onClick={props.onPrepareMerge}
          >
            Merge home
          </Button>
        )}
        {cornerControl}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
        {state.kind === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Reading this line's memory…
          </p>
        ) : state.kind === "error" ? (
          <p className="text-sm text-destructive-foreground" role="alert">
            {state.message}
          </p>
        ) : state.dashboard.kind === "unavailable" ? (
          <UnavailableState
            reason={state.dashboard.reason}
            historical={historical}
            onOpenSettings={props.onOpenSettings}
            onReturnToLatest={props.onReturnToLatest}
          />
        ) : (
          <AvailableDashboard {...props} dashboard={state.dashboard} historical={historical} />
        )}
      </div>
    </div>
  );
}

function UnavailableState({
  reason,
  historical,
  onOpenSettings,
  onReturnToLatest,
}: {
  readonly reason: MemoryUnavailable["reason"];
  readonly historical: boolean;
  readonly onOpenSettings: (() => void) | undefined;
  readonly onReturnToLatest: (() => void) | undefined;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{memoryUnavailableCopy(reason)}</p>
      {reason === "not-designated" && onOpenSettings !== undefined ? (
        <Button size="sm" type="button" variant="outline" onClick={onOpenSettings}>
          Designate memory
        </Button>
      ) : null}
      {historical && onReturnToLatest !== undefined ? (
        <Button size="sm" type="button" variant="outline" onClick={onReturnToLatest}>
          Back to now
        </Button>
      ) : null}
    </div>
  );
}

function AvailableDashboard({
  dashboard,
  historical,
  ...props
}: MemoryTabViewProps & {
  readonly dashboard: MemoryAvailableDashboard;
  readonly historical: boolean;
}) {
  const highlight = useMemo(
    () => memorySelectionHighlight(dashboard, props.selection),
    [dashboard, props.selection],
  );
  const needsReview = useMemo(
    () => memoryNeedsReview(dashboard.amendments),
    [dashboard.amendments],
  );
  const graphEmptyCopy = memoryGraphEmptyCopy(dashboard);
  const changesSummary = memoryChangesSummary(dashboard);
  const empty = dashboard.documents.length === 0 && dashboard.amendments.length === 0;
  const selectDocument = useCallback(
    (id: string) =>
      props.onSelect(
        props.selection?.kind === "document" && props.selection.id === id
          ? null
          : { kind: "document", id },
      ),
    [props],
  );
  const selectAmendment = useCallback(
    (id: string) =>
      props.onSelect(
        props.selection?.kind === "amendment" && props.selection.id === id
          ? null
          : { kind: "amendment", id },
      ),
    [props],
  );
  return (
    <>
      <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
        <p className="text-xs text-muted-foreground" role="status">
          {memoryPositionNotice({
            reading: props.reading,
            position: dashboard.position,
            activeTurn: props.activeTurn,
          })}
        </p>
        {historical && props.onReturnToLatest !== undefined ? (
          <Button size="sm" type="button" variant="outline" onClick={props.onReturnToLatest}>
            Back to now
          </Button>
        ) : null}
        {props.notice ? <p className="text-xs text-foreground">{props.notice}</p> : null}
      </div>

      <MergeHomePanel
        merge={props.merge}
        historical={historical}
        onAppendDraft={props.onAppendDraft}
        onConfirm={props.onConfirmMerge}
        onDismiss={props.onDismissMerge}
        onPrepare={props.onPrepareMerge}
      />

      <Section title="Needs review" count={needsReview.length}>
        {needsReview.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {empty ? "Nothing to review." : "Every change on this line is reviewed."}
          </p>
        ) : (
          needsReview.map((amendment) => (
            <AmendmentRow
              key={amendment.id}
              amendment={amendment}
              dashboard={dashboard}
              historical={historical}
              selected={highlight.amendmentIds.has(amendment.id)}
              onAppendDraft={props.onAppendDraft}
              onMarkReviewed={props.onMarkReviewed}
              onRevert={props.onRevert}
              onSelect={selectAmendment}
              onViewChanges={props.onViewChanges}
            />
          ))
        )}
      </Section>

      <section className="rounded-lg border border-border">
        <button
          aria-expanded={props.graphOpen}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
          type="button"
          onClick={() => props.onGraphOpenChange(!props.graphOpen)}
        >
          {props.graphOpen ? (
            <ChevronDownIcon aria-hidden className="size-4 shrink-0" />
          ) : (
            <ChevronRightIcon aria-hidden className="size-4 shrink-0" />
          )}
          Local graph
          <span className="text-xs font-normal text-muted-foreground">
            {dashboard.graph.nodes.length} {dashboard.graph.nodes.length === 1 ? "note" : "notes"}
          </span>
        </button>
        {props.graphOpen ? (
          <div className="border-t border-border p-3">
            {graphEmptyCopy !== null ? (
              <p className="text-sm text-muted-foreground">{graphEmptyCopy}</p>
            ) : (
              <MemoryLocalGraph
                documents={dashboard.documents}
                graph={dashboard.graph}
                selectedDocumentIds={highlight.documentIds}
                onSelectDocument={selectDocument}
              />
            )}
            {dashboard.graph.outsideReferences.length === 0 ? null : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                References outside the changed set:{" "}
                {[
                  ...new Set(dashboard.graph.outsideReferences.map((reference) => reference.name)),
                ].join(", ")}
                .
              </p>
            )}
          </div>
        ) : null}
      </section>

      <Section title="Changes" count={dashboard.documents.length}>
        {empty ? (
          <EmptyChanges
            browse={props.browse}
            onBrowse={props.onBrowse}
            onOpenDocument={props.onOpenDocument}
          />
        ) : (
          <>
            {changesSummary === null ? null : (
              <p className="text-sm text-muted-foreground">{changesSummary}</p>
            )}
            <ul className="space-y-1.5">
              {dashboard.documents.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  selected={highlight.documentIds.has(document.id)}
                  onOpenDocument={props.onOpenDocument}
                  onSelect={selectDocument}
                  onViewChanges={props.onViewChanges}
                />
              ))}
            </ul>
            <h4 className="mt-3 mb-1.5 text-xs font-medium text-muted-foreground">
              Amendments ({dashboard.amendments.length})
            </h4>
            <div className="space-y-1.5">
              {dashboard.amendments.map((amendment) => (
                <AmendmentRow
                  key={amendment.id}
                  amendment={amendment}
                  dashboard={dashboard}
                  historical={historical}
                  selected={highlight.amendmentIds.has(amendment.id)}
                  onAppendDraft={props.onAppendDraft}
                  onMarkReviewed={props.onMarkReviewed}
                  onRevert={props.onRevert}
                  onSelect={selectAmendment}
                  onViewChanges={props.onViewChanges}
                />
              ))}
            </div>
          </>
        )}
      </Section>

      {dashboard.limitations.length === 0 ? null : (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground/80">
          {dashboard.limitations.map((limitation) => (
            <li key={limitation}>{memoryLimitationCopy(limitation)}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {title}
        <span className="text-xs font-normal text-muted-foreground">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function MergeHomePanel({
  merge,
  historical,
  onPrepare,
  onConfirm,
  onDismiss,
  onAppendDraft,
}: {
  readonly merge: MemoryMergeState;
  readonly historical: boolean;
  readonly onPrepare: () => void;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
  readonly onAppendDraft: (text: string) => void;
}) {
  if (merge.kind === "idle") return null;
  return (
    <section
      className="space-y-2 rounded-lg border border-border bg-background p-3"
      aria-live="polite"
    >
      {merge.kind === "busy" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {merge.step === "prepare" ? "Preparing the merge review…" : "Merging home…"}
        </p>
      ) : merge.kind === "review" ? (
        <>
          <p className="text-sm">
            {merge.stale
              ? "Memory changed since this review was prepared. Prepare again to continue."
              : memoryMergeHomeOutcomeCopy({ kind: "review-required", review: merge.review })}
          </p>
          {merge.review.unmarkedId === null ? null : (
            <p className="text-xs text-muted-foreground">
              Confirming also commits the captured, uncommitted tail as a reviewed amendment.
            </p>
          )}
          {merge.review.warnings.length === 0 ? null : (
            <ul className="space-y-0.5 text-xs text-warning-foreground">
              {merge.review.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" type="button" variant="ghost" onClick={onDismiss}>
              Not now
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={historical}
              onClick={onPrepare}
            >
              Prepare again
            </Button>
            <Button
              size="sm"
              type="button"
              disabled={historical || !memoryMergeReviewIsConfirmable(merge)}
              onClick={onConfirm}
            >
              Confirm merge home
            </Button>
          </div>
        </>
      ) : merge.kind === "error" ? (
        <>
          <p className="text-sm text-destructive-foreground" role="alert">
            {merge.message}
          </p>
          <div className="flex justify-end">
            <Button size="sm" type="button" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">{memoryMergeStateCopy(merge)}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" type="button" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
            {merge.kind === "deferred-to-push" && merge.stale ? (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={historical}
                onClick={onPrepare}
              >
                Prepare again
              </Button>
            ) : null}
            {merge.kind === "conflict" ? (
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => onAppendDraft(memoryMergeHomeReconciliationMessage(merge.paths))}
              >
                Reconcile in the conversation
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function EmptyChanges({
  browse,
  onBrowse,
  onOpenDocument,
}: {
  readonly browse: MemoryBrowseState;
  readonly onBrowse: () => void;
  readonly onOpenDocument: (target: MemoryDocumentTarget) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">This line has not changed project memory.</p>
      {browse.kind === "idle" ? (
        <Button size="sm" type="button" variant="outline" onClick={onBrowse}>
          Browse memory
        </Button>
      ) : browse.kind === "loading" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Listing memory files…
        </p>
      ) : browse.kind === "error" ? (
        <p className="text-sm text-destructive-foreground" role="alert">
          {browse.message}
        </p>
      ) : browse.catalog.kind === "unavailable" ? (
        <p className="text-sm text-muted-foreground">
          {memoryUnavailableCopy(browse.catalog.reason)}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {memoryBrowseEntries(browse.catalog).map((entry) => {
            const position = browse.catalog.kind === "available" ? browse.catalog.position : null;
            return position === null ? null : (
              <li key={entry.path}>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent/50"
                  type="button"
                  onClick={() =>
                    onOpenDocument(memoryDocumentTargetForCatalogEntry(position, entry))
                  }
                >
                  {entry.kind === "skill-map" ? (
                    <MapIcon aria-hidden className="size-3.5 shrink-0" />
                  ) : (
                    <BookOpenIcon aria-hidden className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{entry.path}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DocumentRow({
  document,
  selected,
  onSelect,
  onOpenDocument,
  onViewChanges,
}: {
  readonly document: MemoryChangedDocument;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly onOpenDocument: (target: MemoryDocumentTarget) => void;
  readonly onViewChanges: (target: MemoryComparisonTarget, label: string) => void;
}) {
  const status = memoryDocumentStatusLabel(document);
  return (
    <li
      className={cn(
        "rounded-lg border bg-background px-3 py-2",
        selected ? "border-primary" : "border-border",
      )}
      data-memory-document={document.id}
    >
      <div className="flex items-start gap-2">
        <button
          aria-pressed={selected}
          className="min-w-0 flex-1 text-left"
          type="button"
          onClick={() => onSelect(document.id)}
        >
          <span className="flex items-center gap-1.5">
            {document.kind === "skill-map" ? (
              <MapIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <FileTextIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate text-sm font-medium">{document.path}</span>
          </span>
          <span className="block text-xs text-muted-foreground">
            {memoryDocumentKindLabel(document.kind)} · {status}
            {document.amendmentIds.length > 0
              ? ` · ${document.amendmentIds.length} ${document.amendmentIds.length === 1 ? "amendment" : "amendments"}`
              : ""}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {document.document === null ? null : (
            <Button
              aria-label={`Open ${document.path} in Files`}
              size="icon-xs"
              type="button"
              variant="ghost"
              onClick={() => onOpenDocument(document.document!)}
            >
              <FileTextIcon className="size-3.5" />
            </Button>
          )}
          <Button
            aria-label={`View changes to ${document.path}`}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() =>
              onViewChanges(
                document.comparison,
                memoryComparisonLabel({ kind: "document", document }),
              )
            }
          >
            <FileDiffIcon className="size-3.5" />
          </Button>
        </div>
      </div>
      {document.status === "deleted" && document.document !== null ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Opening shows the former version, as it was before deletion.
        </p>
      ) : null}
    </li>
  );
}

function AmendmentRow({
  amendment,
  dashboard,
  historical,
  selected,
  onSelect,
  onMarkReviewed,
  onRevert,
  onViewChanges,
  onAppendDraft,
}: {
  readonly amendment: MemoryAmendmentSummary;
  readonly dashboard: MemoryAvailableDashboard;
  readonly historical: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly onMarkReviewed: MemoryTabViewProps["onMarkReviewed"];
  readonly onRevert: MemoryTabViewProps["onRevert"];
  readonly onViewChanges: MemoryTabViewProps["onViewChanges"];
  readonly onAppendDraft: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<MemoryCurationRefusal | null>(null);
  const act = async (run: () => Promise<MemoryCurationRefusal | null>) => {
    setBusy(true);
    setRefusal(null);
    try {
      setRefusal(await run());
    } finally {
      setBusy(false);
    }
  };
  const documents = amendment.documentIds
    .map((id) => dashboard.documents.find((document) => document.id === id))
    .filter((document): document is MemoryChangedDocument => document !== undefined);
  const reverts =
    amendment.revertsAmendmentId === undefined
      ? null
      : (dashboard.amendments.find((candidate) => candidate.id === amendment.revertsAmendmentId) ??
        null);
  const title = amendment.title || amendment.id.slice(0, 8);
  return (
    <section
      className={cn(
        "rounded-lg border bg-background px-3 py-2",
        selected ? "border-primary" : "border-border",
      )}
      data-memory-amendment={amendment.id}
    >
      <div className="flex items-start gap-2">
        <button
          aria-pressed={selected}
          className="min-w-0 flex-1 text-left"
          type="button"
          onClick={() => onSelect(amendment.id)}
        >
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">
            {memoryAmendmentAttribution(amendment.kind)}
            {amendment.turnId === null ||
            amendment.kind !== "marked" ||
            amendment.revertsAmendmentId !== undefined
              ? ""
              : ` · turn ${amendment.turnId}`}
            {" · "}
            {amendment.reviewed ? "Reviewed" : "Needs review"}
          </span>
          {amendment.revertsAmendmentId === undefined ? null : (
            <span className="block text-xs text-muted-foreground">
              Reverts{" "}
              {reverts === null
                ? amendment.revertsAmendmentId.slice(0, 8)
                : `"${reverts.title || reverts.id.slice(0, 8)}"`}
            </span>
          )}
          {documents.length === 0 ? null : (
            <span className="block truncate text-[11px] text-muted-foreground">
              {documents.map((document) => document.path).join(", ")}
            </span>
          )}
        </button>
        <Button
          aria-label={`View changes in ${title}`}
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={() => onViewChanges(amendment.comparison, memoryComparisonLabel(amendment))}
        >
          <FileDiffIcon className="size-3.5" />
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
        {amendment.reviewed ? null : (
          <Button
            disabled={busy || historical}
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => void act(() => onMarkReviewed(amendment.id))}
          >
            Mark reviewed
          </Button>
        )}
        <Button
          disabled={busy || historical}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => void act(() => onRevert(amendment))}
        >
          Revert
        </Button>
      </div>
      {refusal === null ? null : (
        <div className="mt-1.5 space-y-1">
          <p className="text-xs text-destructive-foreground" role="alert">
            {refusal.message}
          </p>
          {refusal.reconciliationSeed === undefined && refusal.paths === undefined ? null : (
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() =>
                onAppendDraft(
                  refusal.reconciliationSeed ?? memoryRevertInvestigationMessage(amendment),
                )
              }
            >
              Add reconciliation to draft
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
