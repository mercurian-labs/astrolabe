import type {
  MercurianCommitId,
  PlanId,
  PlanOrigin,
  PlanSpecAt,
  PlanTimelineItem,
  SpecDocument,
} from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "../../lib/utils";
import { useRefreshSpec, useSaveSpecRevision } from "../../state/mercurian";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { expectedSpecRevisionId, lastSpecRevision, specRevisionLabel } from "./SpecArtifact.logic";

interface Reconciliation {
  readonly base: SpecDocument;
  readonly local: SpecDocument;
  readonly upstream: SpecDocument;
  readonly expectedSpecRevisionCommitId: MercurianCommitId;
}

export function SpecArtifact({
  planId,
  spec,
  origin,
  parentCommitId,
  timeline,
  readOnly = false,
  turnActive = false,
  readOnlyAction,
  titleControl,
}: {
  readonly planId: PlanId;
  readonly spec: PlanSpecAt | null;
  readonly origin?: PlanOrigin;
  readonly parentCommitId?: MercurianCommitId;
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  readonly readOnly?: boolean;
  readonly turnActive?: boolean;
  readonly readOnlyAction?: ReactNode;
  /** The planning-space artifact picker; omitted in standalone renderings. */
  readonly titleControl?: ReactNode;
}) {
  const saveSpecRevision = useSaveSpecRevision();
  const refreshSpec = useRefreshSpec();
  const [draft, setDraft] = useState<SpecDocument | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [resolved, setResolved] = useState<SpecDocument | null>(null);
  const revision = lastSpecRevision(timeline);
  const editable = !readOnly && !turnActive && parentCommitId !== undefined;

  const save = useCallback(async () => {
    if (draft === null || parentCommitId === undefined || isSaving) return;
    setIsSaving(true);
    setNotice(null);
    const saved = await saveSpecRevision({
      planId,
      parentCommitId,
      expectedSpecRevisionCommitId: expectedSpecRevisionId(timeline),
      document: draft,
    });
    setIsSaving(false);
    if (saved !== null) setDraft(null);
  }, [draft, isSaving, parentCommitId, planId, saveSpecRevision, timeline]);

  const refresh = useCallback(async () => {
    const expected = expectedSpecRevisionId(timeline);
    if (parentCommitId === undefined || expected === null || isRefreshing) return;
    setIsRefreshing(true);
    setNotice(null);
    const result = await refreshSpec({
      planId,
      parentCommitId,
      expectedSpecRevisionCommitId: expected,
    });
    setIsRefreshing(false);
    if (result === null) return;
    if (result.kind === "unchanged") {
      setNotice("Already current with the issue.");
      return;
    }
    if (result.kind === "reconciliation-required") {
      setReconciliation(result);
      setResolved(result.local);
      return;
    }
    setNotice(
      result.outcome === "converged"
        ? "The local spec already matched the issue; its baseline is now current."
        : "Spec refreshed from the issue.",
    );
  }, [isRefreshing, parentCommitId, planId, refreshSpec, timeline]);

  const confirmReconciliation = useCallback(async () => {
    if (reconciliation === null || resolved === null || parentCommitId === undefined) return;
    setIsRefreshing(true);
    const result = await refreshSpec({
      planId,
      parentCommitId,
      expectedSpecRevisionCommitId: reconciliation.expectedSpecRevisionCommitId,
      reviewedUpstream: reconciliation.upstream,
      resolvedDocument: resolved,
    });
    setIsRefreshing(false);
    if (result === null) return;
    if (result.kind === "reconciliation-required") {
      setReconciliation(result);
      setResolved(result.local);
      return;
    }
    setReconciliation(null);
    setResolved(null);
    setNotice("Spec reconciled with the issue.");
  }, [parentCommitId, planId, reconciliation, refreshSpec, resolved]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        {titleControl ?? <h2 className="text-sm font-medium text-foreground">Spec</h2>}
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
          {specRevisionLabel(revision)}
        </span>
        {readOnly ? (
          readOnlyAction
        ) : draft === null ? (
          <div className="flex items-center gap-1">
            {origin === undefined || spec === null ? null : (
              <Button
                disabled={!editable || isRefreshing}
                size="sm"
                variant="ghost"
                onClick={() => void refresh()}
              >
                <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
                Refresh from issue
              </Button>
            )}
            <Button
              disabled={!editable}
              size="sm"
              variant="ghost"
              onClick={() => setDraft(spec?.document ?? { title: "", description: "" })}
            >
              <PencilIcon className="size-3.5" />
              {spec === null ? "Draft spec" : "Edit"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                isSaving ||
                draft.title.trim().length === 0 ||
                (spec !== null &&
                  draft.title === spec.document.title &&
                  draft.description === spec.document.description)
              }
              size="sm"
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        )}
      </div>
      {origin === undefined ? null : (
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground sm:px-4">
          <span>From issue {origin.issueId}</span>
          <a
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
            href={origin.issueUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open issue <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      )}
      {notice === null ? null : (
        <p className="border-b border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:px-4">
          {notice}
        </p>
      )}
      {turnActive && !readOnly ? (
        <p className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground sm:px-4">
          The assistant is replying. Stop it before editing the spec.
        </p>
      ) : null}
      {draft === null || readOnly ? (
        <SpecBody document={spec?.document ?? null} />
      ) : (
        <SpecEditor document={draft} onChange={setDraft} onSave={() => void save()} />
      )}
      <SpecReconciliationDialog
        open={reconciliation !== null}
        reconciliation={reconciliation}
        resolved={resolved}
        saving={isRefreshing}
        onChange={setResolved}
        onConfirm={() => void confirmReconciliation()}
        onOpenChange={(open) => {
          if (!open) {
            setReconciliation(null);
            setResolved(null);
          }
        }}
      />
    </section>
  );
}

function SpecBody({ document }: { readonly document: SpecDocument | null }) {
  if (document === null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-4">
        <p className="text-sm text-muted-foreground/70">
          No spec yet — draft the contract this plan is planned from.
        </p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
      <h1 className="text-base font-semibold text-foreground">{document.title}</h1>
      <div
        className={cn(
          "mt-3 text-sm text-foreground",
          "[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3",
          "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-semibold [&_li]:my-0.5",
          "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        )}
      >
        <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
          {document.description}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function SpecEditor({
  document,
  onChange,
  onSave,
}: {
  readonly document: SpecDocument;
  readonly onChange: (document: SpecDocument) => void;
  readonly onSave: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <Input
        aria-label="Spec title"
        autoFocus
        placeholder="User story or outcome"
        value={document.title}
        onChange={(event) => onChange({ ...document, title: event.target.value })}
      />
      <textarea
        aria-label="Spec description"
        className="min-h-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-hidden focus-visible:border-ring"
        placeholder="Describe behavior and acceptance criteria"
        value={document.description}
        onChange={(event) => onChange({ ...document, description: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSave();
          }
        }}
      />
    </div>
  );
}

function SpecReconciliationDialog({
  open,
  reconciliation,
  resolved,
  saving,
  onChange,
  onConfirm,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly reconciliation: Reconciliation | null;
  readonly resolved: SpecDocument | null;
  readonly saving: boolean;
  readonly onChange: (document: SpecDocument) => void;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Reconcile spec changes</DialogTitle>
          <DialogDescription>
            The issue and this path both changed. Review all three versions; nothing is written
            until you confirm.
          </DialogDescription>
        </DialogHeader>
        {reconciliation === null || resolved === null ? null : (
          <DialogPanel className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <SpecSnapshot label="Base" document={reconciliation.base} />
              <SpecSnapshot label="Local" document={reconciliation.local} />
              <SpecSnapshot label="Upstream" document={reconciliation.upstream} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onChange(reconciliation.local)}>
                Use local
              </Button>
              <Button size="sm" variant="outline" onClick={() => onChange(reconciliation.upstream)}>
                Use upstream
              </Button>
            </div>
            <Input
              aria-label="Resolved spec title"
              value={resolved.title}
              onChange={(event) => onChange({ ...resolved, title: event.target.value })}
            />
            <textarea
              aria-label="Resolved spec description"
              className="min-h-36 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-hidden focus-visible:border-ring"
              value={resolved.description}
              onChange={(event) => onChange({ ...resolved, description: event.target.value })}
            />
          </DialogPanel>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || resolved === null || resolved.title.trim().length === 0}
            onClick={onConfirm}
          >
            Confirm reconciliation
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function SpecSnapshot({
  label,
  document,
}: {
  readonly label: string;
  readonly document: SpecDocument;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border p-3">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      <p className="mt-2 text-sm font-medium text-foreground">{document.title}</p>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
        {document.description}
      </pre>
    </div>
  );
}
