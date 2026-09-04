import type {
  MemoryLineRef,
  MercurianLineMemoryChanges,
  MercurianMergeMemoryHomeResult,
} from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  useMarkMemoryChangeReviewed,
  useMergeMemoryHome,
  useReadLineMemoryChanges,
  useRevertMemoryChange,
} from "../../state/mercurianMemory";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { WORKSPACE_PANE_TITLE_BAR_CLASS } from "../../workspaceTitlebar";
import { Button } from "../ui/button";
import { MemoryDiffViewer } from "./MemoryAmendmentSheet";
import {
  memoryMergeHomeOutcomeCopy,
  memoryMergeHomeReconciliationMessage,
  memoryMergeHomeRefusalCopy,
  memoryMergeHomeWalk,
  memoryTabRevertTarget,
  memoryTabRows,
  memoryTabUnreviewedCount,
} from "./MemoryTab.logic";

const EMPTY: MercurianLineMemoryChanges = {
  marked: [],
  hand: [],
  unmarked: null,
  unreviewedCount: 0,
};

export function MemoryTab({
  line,
  cornerControl,
  onUnreviewedCountChange,
  worktreePath,
  mergeHomeConflict,
  onReconcile,
}: {
  readonly line: MemoryLineRef;
  readonly cornerControl?: ReactNode;
  readonly onUnreviewedCountChange?: (count: number) => void;
  readonly worktreePath?: string | null;
  readonly mergeHomeConflict?: ReadonlyArray<{ readonly path: string }> | null;
  readonly onReconcile?: (message: string) => void;
}) {
  const readChanges = useReadLineMemoryChanges();
  const markReviewed = useMarkMemoryChangeReviewed();
  const revertChange = useRevertMemoryChange();
  const mergeHome = useMergeMemoryHome();
  const environmentId = usePrimaryEnvironmentId();
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const [result, setResult] = useState<{
    readonly lineKey: string;
    readonly changes: MercurianLineMemoryChanges;
    readonly error: string | null;
  } | null>(null);
  const lineKey =
    "threadId" in line ? `thread:${line.threadId}` : `plan:${line.planId}:${line.commitId}`;
  const refresh = useCallback(async () => {
    const next = await readChanges({ line });
    setResult({
      lineKey,
      changes: next.ok ? next.value : EMPTY,
      error: next.ok
        ? null
        : next.error instanceof Error
          ? next.error.message
          : "Could not read this line's memory changes.",
    });
    if (next.ok) onUnreviewedCountChange?.(memoryTabUnreviewedCount(next.value));
  }, [line, lineKey, onUnreviewedCountChange, readChanges]);
  useEffect(() => {
    let active = true;
    void readChanges({ line }).then((result) => {
      if (!active) return;
      setResult({
        lineKey,
        changes: result.ok ? result.value : EMPTY,
        error: result.ok
          ? null
          : result.error instanceof Error
            ? result.error.message
            : "Could not read this line's memory changes.",
      });
      if (result.ok) onUnreviewedCountChange?.(memoryTabUnreviewedCount(result.value));
    });
    return () => {
      active = false;
    };
  }, [line, lineKey, onUnreviewedCountChange, readChanges]);
  useEffect(() => {
    if (environmentId === null || worktreePath == null) return;
    void refreshVcsStatus({
      environmentId,
      input: { cwd: worktreePath },
    });
  }, [environmentId, refreshVcsStatus, worktreePath]);
  const current = result?.lineKey === lineKey ? result : null;
  return (
    <MemoryTabView
      changes={current?.changes ?? EMPTY}
      loading={current === null}
      error={current?.error ?? null}
      {...(cornerControl === undefined ? {} : { cornerControl })}
      {...(mergeHomeConflict === undefined ? {} : { mergeHomeConflict })}
      {...(onReconcile === undefined ? {} : { onReconcile })}
      onMarkReviewed={async (commitOid) => {
        const marked = await markReviewed({ line, commitOid });
        if (!marked.ok) throw marked.error;
        await refresh();
      }}
      onRevert={async (target) => {
        const reverted = await revertChange({ line, target });
        if (!reverted.ok) throw reverted.error;
        await refresh();
      }}
      onMergeHome={async () => {
        const merged = await mergeHome({ line });
        if (!merged.ok) throw merged.error;
        await refresh();
        return merged.value;
      }}
    />
  );
}

export function MemoryTabView({
  changes,
  loading = false,
  error = null,
  cornerControl,
  onMarkReviewed,
  onRevert,
  onMergeHome,
  mergeHomeConflict = null,
  onReconcile,
}: {
  readonly changes: MercurianLineMemoryChanges;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly cornerControl?: ReactNode;
  readonly onMarkReviewed?: (commitOid: string) => Promise<void>;
  readonly onRevert?: (
    target: { readonly kind: "commit"; readonly commitOid: string } | { readonly kind: "unmarked" },
  ) => Promise<void>;
  readonly onMergeHome?: () => Promise<MercurianMergeMemoryHomeResult>;
  readonly mergeHomeConflict?: ReadonlyArray<{ readonly path: string }> | null;
  readonly onReconcile?: (message: string) => void;
}) {
  const rows = useMemo(() => memoryTabRows(changes), [changes]);
  const [walk, setWalk] = useState<ReadonlyArray<(typeof rows)[number]> | null>(null);
  const [walkIndex, setWalkIndex] = useState(0);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeResult, setMergeResult] = useState<MercurianMergeMemoryHomeResult | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const currentWalkRow = walk?.[walkIndex] ?? null;
  const atDecision = walk !== null && currentWalkRow === null;
  const visibleConflictPaths =
    mergeResult?.kind === "conflict"
      ? mergeResult.conflicts.map(({ path }) => path)
      : (mergeHomeConflict?.map(({ path }) => path) ?? []);
  const beginWalk = () => {
    setWalk(memoryMergeHomeWalk(changes));
    setWalkIndex(0);
    setMergeError(null);
  };
  const reviewCurrent = async () => {
    if (currentWalkRow === null) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      if (currentWalkRow.kind !== "unmarked" && onMarkReviewed !== undefined) {
        await onMarkReviewed(currentWalkRow.id);
      }
      setWalkIndex((index) => index + 1);
    } catch (cause) {
      setMergeError(memoryMergeHomeRefusalCopy(cause));
    } finally {
      setMergeBusy(false);
    }
  };
  const confirmMerge = async () => {
    if (onMergeHome === undefined) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      setMergeResult(await onMergeHome());
      setWalk(null);
    } catch (cause) {
      setMergeError(memoryMergeHomeRefusalCopy(cause));
    } finally {
      setMergeBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`${WORKSPACE_PANE_TITLE_BAR_CLASS} gap-2 border-b border-border px-3 sm:px-4`}
      >
        <h2 className="text-sm font-medium">Memory changes</h2>
        <span className="min-w-0 flex-1" />
        {onMergeHome === undefined ? null : (
          <Button
            disabled={mergeBusy}
            size="sm"
            type="button"
            variant="secondary"
            onClick={beginWalk}
          >
            Merge home
          </Button>
        )}
        {cornerControl}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
        {mergeResult === null ? null : (
          <p className="text-sm text-muted-foreground">{memoryMergeHomeOutcomeCopy(mergeResult)}</p>
        )}
        {mergeResult === null && visibleConflictPaths.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {memoryMergeHomeOutcomeCopy({
              kind: "conflict",
              conflicts: visibleConflictPaths.map((path) => ({ path })),
            })}
          </p>
        ) : null}
        {visibleConflictPaths.length === 0 || onReconcile === undefined ? null : (
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => onReconcile(memoryMergeHomeReconciliationMessage(visibleConflictPaths))}
          >
            Reconcile in the conversation
          </Button>
        )}
        {walk === null ? null : currentWalkRow !== null ? (
          <section className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2">
              <p className="text-sm font-medium">{currentWalkRow.title}</p>
              <p className="text-xs text-muted-foreground">
                Review {walkIndex + 1} of {walk.length}
              </p>
            </div>
            <MemoryDiffViewer
              id={`memory-merge:${currentWalkRow.id}`}
              patch={currentWalkRow.diff}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                disabled={mergeBusy}
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => setWalk(null)}
              >
                Not now
              </Button>
              <Button
                disabled={mergeBusy}
                size="sm"
                type="button"
                onClick={() => void reviewCurrent()}
              >
                Reviewed
              </Button>
            </div>
          </section>
        ) : atDecision ? (
          <section className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-sm">Every memory change in this line has been reviewed.</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                disabled={mergeBusy}
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => setWalk(null)}
              >
                Not now
              </Button>
              <Button
                disabled={mergeBusy}
                size="sm"
                type="button"
                onClick={() => void confirmMerge()}
              >
                Merge home
              </Button>
            </div>
          </section>
        ) : null}
        {mergeError === null ? null : <p className="text-sm text-destructive">{mergeError}</p>}
        {walk !== null ? null : (
          <>
            {loading ? (
              <p className="text-sm text-muted-foreground">Reading memory changes…</p>
            ) : null}
            {error === null ? null : <p className="text-sm text-destructive">{error}</p>}
            {!loading && error === null && rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This line has not changed project memory.
              </p>
            ) : null}
            {rows.map((row) => (
              <MemoryChangeRow
                key={row.id}
                row={row}
                {...(onMarkReviewed === undefined ? {} : { onMarkReviewed })}
                {...(onRevert === undefined ? {} : { onRevert })}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function MemoryChangeRow({
  row,
  onMarkReviewed,
  onRevert,
}: {
  readonly row: ReturnType<typeof memoryTabRows>[number];
  readonly onMarkReviewed?: (commitOid: string) => Promise<void>;
  readonly onRevert?: MemoryTabViewProps["onRevert"];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        typeof cause === "object" &&
          cause !== null &&
          "_tag" in cause &&
          cause._tag === "MemoryReviewBlockedError" &&
          "reason" in cause &&
          cause.reason === "turn-active"
          ? "Wait for the active turn to finish before reverting memory changes."
          : cause instanceof Error
            ? cause.message
            : "Could not update this memory change.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-lg border border-border bg-background">
      <Button
        className="h-auto w-full justify-start gap-2 px-3 py-2 text-left"
        variant="ghost"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDownIcon
          className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.title}</span>
          <span className="block text-xs text-muted-foreground">
            {row.attribution}
            {row.authoredAt === null ? "" : ` · ${new Date(row.authoredAt).toLocaleString()}`}
          </span>
        </span>
      </Button>
      {open ? (
        <div className="border-t border-border p-2">
          <MemoryDiffViewer id={`memory:${row.id}`} patch={row.diff} />
          <div className="mt-2 flex items-center justify-end gap-2">
            {row.kind !== "unmarked" && !row.reviewed && onMarkReviewed !== undefined ? (
              <Button
                disabled={busy}
                size="sm"
                variant="secondary"
                onClick={() => void act(() => onMarkReviewed(row.id))}
              >
                Reviewed
              </Button>
            ) : null}
            {onRevert === undefined ? null : (
              <Button
                disabled={busy}
                size="sm"
                variant="destructive"
                onClick={() => void act(() => onRevert(memoryTabRevertTarget(row)))}
              >
                Revert
              </Button>
            )}
          </div>
          {error === null ? null : <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      ) : null}
    </section>
  );
}

type MemoryTabViewProps = Parameters<typeof MemoryTabView>[0];
