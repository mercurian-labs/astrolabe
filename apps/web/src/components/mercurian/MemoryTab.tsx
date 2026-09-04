import type { MemoryLineRef, MercurianLineMemoryChanges } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useReadLineMemoryChanges } from "../../state/mercurianMemory";
import { WORKSPACE_PANE_TITLE_BAR_CLASS } from "../../workspaceTitlebar";
import { Button } from "../ui/button";
import { MemoryDiffViewer } from "./MemoryAmendmentSheet";
import { memoryTabRows } from "./MemoryTab.logic";

const EMPTY: MercurianLineMemoryChanges = { marked: [], hand: [], unmarked: null };

export function MemoryTab({
  line,
  cornerControl,
}: {
  readonly line: MemoryLineRef;
  readonly cornerControl?: ReactNode;
}) {
  const readChanges = useReadLineMemoryChanges();
  const [result, setResult] = useState<{
    readonly lineKey: string;
    readonly changes: MercurianLineMemoryChanges;
    readonly error: string | null;
  } | null>(null);
  const lineKey =
    "threadId" in line ? `thread:${line.threadId}` : `plan:${line.planId}:${line.commitId}`;
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
    });
    return () => {
      active = false;
    };
  }, [line, lineKey, readChanges]);
  const current = result?.lineKey === lineKey ? result : null;
  return (
    <MemoryTabView
      changes={current?.changes ?? EMPTY}
      loading={current === null}
      error={current?.error ?? null}
      cornerControl={cornerControl}
    />
  );
}

export function MemoryTabView({
  changes,
  loading = false,
  error = null,
  cornerControl,
}: {
  readonly changes: MercurianLineMemoryChanges;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly cornerControl?: ReactNode;
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
          <MemoryChangeRow key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function MemoryChangeRow({ row }: { readonly row: ReturnType<typeof memoryTabRows>[number] }) {
  const [open, setOpen] = useState(false);
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
        </div>
      ) : null}
    </section>
  );
}
