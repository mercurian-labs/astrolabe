import type { MemoryLineRef, MercurianLineMemoryChanges } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  useMarkMemoryChangeReviewed,
  useReadLineMemoryChanges,
  useRevertMemoryChange,
} from "../../state/mercurianMemory";
import { WORKSPACE_PANE_TITLE_BAR_CLASS } from "../../workspaceTitlebar";
import { Button } from "../ui/button";
import { MemoryDiffViewer } from "./MemoryAmendmentSheet";
import { memoryTabRevertTarget, memoryTabRows, memoryTabUnreviewedCount } from "./MemoryTab.logic";

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
}: {
  readonly line: MemoryLineRef;
  readonly cornerControl?: ReactNode;
  readonly onUnreviewedCountChange?: (count: number) => void;
}) {
  const readChanges = useReadLineMemoryChanges();
  const markReviewed = useMarkMemoryChangeReviewed();
  const revertChange = useRevertMemoryChange();
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
  const current = result?.lineKey === lineKey ? result : null;
  return (
    <MemoryTabView
      changes={current?.changes ?? EMPTY}
      loading={current === null}
      error={current?.error ?? null}
      cornerControl={cornerControl}
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
}: {
  readonly changes: MercurianLineMemoryChanges;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly cornerControl?: ReactNode;
  readonly onMarkReviewed?: (commitOid: string) => Promise<void>;
  readonly onRevert?: (
    target: { readonly kind: "commit"; readonly commitOid: string } | { readonly kind: "unmarked" },
  ) => Promise<void>;
}) {
  const rows = useMemo(() => memoryTabRows(changes), [changes]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`${WORKSPACE_PANE_TITLE_BAR_CLASS} gap-2 border-b border-border px-3 sm:px-4`}
      >
        <h2 className="text-sm font-medium">Memory changes</h2>
        <span className="min-w-0 flex-1" />
        {cornerControl}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
        {loading ? <p className="text-sm text-muted-foreground">Reading memory changes…</p> : null}
        {error === null ? null : <p className="text-sm text-destructive">{error}</p>}
        {!loading && error === null && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">This line has not changed project memory.</p>
        ) : null}
        {rows.map((row) => (
          <MemoryChangeRow
            key={row.id}
            row={row}
            {...(onMarkReviewed === undefined ? {} : { onMarkReviewed })}
            {...(onRevert === undefined ? {} : { onRevert })}
          />
        ))}
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
