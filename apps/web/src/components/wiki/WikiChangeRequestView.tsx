import type {
  EnvironmentId,
  ThreadId,
  ThreadPullRequestLink,
  WikiAmendmentSummary,
  WikiChangeRequestId,
  WikiFileChange,
  WikiId,
} from "@t3tools/contracts";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { useTheme } from "~/hooks/useTheme";
import { ensureLocalApi } from "~/localApi";
import { useThreadShell } from "~/state/entities";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import type { FullPullRequestTarget } from "../pullRequest/pullRequestTabs";
import {
  changeRequestPullRequests,
  pullRequestNudge,
  unmergedPullRequests,
} from "@t3tools/client-runtime/wikiPullRequests";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  describeIndexError,
  describeWikiFailure,
  mergeBlockedReason,
  noteNameOfFile,
} from "./wiki.logic";
import { useWikiCommand } from "./wikiEnvironment";
import { WikiPart } from "./WikiParts";

const STATUS_BADGE = { open: "info", merged: "success", closed: "secondary" } as const;
const STATUS_LABEL = { open: "Open", merged: "Merged", closed: "Closed" } as const;

/** A change request: what it changes, who changed it, and whether it can merge. */
export function WikiChangeRequestView({
  environmentId,
  wikiId,
  changeRequestId,
  onOpenNote,
  onOpenThread,
  onOpenPullRequest,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId;
  readonly onOpenNote: (name: string) => void;
  /** Astrolabe: shows the change request's thread beside it; without it, the link goes there. */
  readonly onOpenThread?: (threadId: ThreadId) => void;
  /** Astrolabe: shows one of its thread's pull requests beside it. */
  readonly onOpenPullRequest?: (target: FullPullRequestTarget) => void;
}) {
  const detail = useEnvironmentQuery(
    wikiEnvironment.changeRequest({ environmentId, input: { wikiId, changeRequestId } }),
  );
  // Astrolabe: the pull requests of the thread that wrote it (see `changeRequestPullRequests`).
  const threadId = detail.data?.changeRequest.threadId ?? null;
  const thread = useThreadShell(threadId === null ? null : scopeThreadRef(environmentId, threadId));
  const pullRequestLinks = thread?.pullRequests ?? NO_LINKS;
  const canMerge = useAtomValue(wikiEnvironment.merge.permissionAtom(environmentId));
  const canSetStatus = useAtomValue(
    wikiEnvironment.setChangeRequestStatus.permissionAtom(environmentId),
  );
  const merge = useWikiCommand(wikiEnvironment.merge, "Couldn't merge");
  const setStatus = useWikiCommand(wikiEnvironment.setChangeRequestStatus, "Couldn't update");
  const [busy, setBusy] = useState<"merge" | "status" | null>(null);

  if (detail.data === null) {
    return detail.error !== null ? (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Couldn't open this change request</EmptyTitle>
          <EmptyDescription>{describeWikiFailure(detail.failure ?? detail.error)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    ) : (
      <Empty>
        <Spinner size="md" tone="muted" />
      </Empty>
    );
  }

  const { changeRequest, files, mergePreview } = detail.data;
  const open = changeRequest.status === "open";
  const blocked = mergeBlockedReason({ canWrite: canMerge, preview: mergePreview });
  const errors = (open ? mergePreview.errors : detail.data.errors).map(describeIndexError);
  const target = { wikiId, changeRequestId };

  const runMerge = async () => {
    // Merging the docs before the code is allowed, after saying so.
    const waiting = unmergedPullRequests(pullRequestLinks);
    if (waiting.length > 0) {
      const names = waiting.map((link) => `#${link.number}`).join(", ");
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `${waiting.length === 1 ? "Pull request" : "Pull requests"} ${names} ${waiting.length === 1 ? "hasn't" : "haven't"} merged yet, so these docs would describe code that isn't on main. Merge them anyway?`,
      );
      if (!confirmed) return;
    }
    setBusy("merge");
    await merge({ environmentId, input: target });
    setBusy(null);
  };
  const runStatus = async (status: "open" | "closed") => {
    setBusy("status");
    await setStatus({ environmentId, input: { ...target, status } });
    setBusy(null);
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pt-6 pb-12">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-lg font-semibold break-words">{changeRequest.title}</h2>
            <Badge variant={STATUS_BADGE[changeRequest.status]}>
              {STATUS_LABEL[changeRequest.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {`Opened by ${changeRequest.createdBy} ${formatRelativeTimeLabel(changeRequest.createdAt)}`}
            {changeRequest.threadId ? (
              <>
                {" · "}
                {onOpenThread ? (
                  <button
                    type="button"
                    className="cursor-pointer underline-offset-4 hover:underline"
                    onClick={() => {
                      if (changeRequest.threadId) onOpenThread(changeRequest.threadId);
                    }}
                  >
                    Open thread
                  </button>
                ) : (
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId, threadId: changeRequest.threadId }}
                    className="underline-offset-4 hover:underline"
                  >
                    Open thread
                  </Link>
                )}
              </>
            ) : null}
            {changeRequest.mergedCommit
              ? ` · Merged as ${changeRequest.mergedCommit.slice(0, 7)}`
              : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {open ? (
              <>
                <MergeButton
                  blocked={blocked}
                  busy={busy === "merge"}
                  disabled={busy !== null}
                  onMerge={() => void runMerge()}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canSetStatus || busy !== null}
                  onClick={() => void runStatus("closed")}
                >
                  {busy === "status" ? <Spinner /> : <PullRequestGlyph.closed />}
                  Close
                </Button>
              </>
            ) : changeRequest.status === "closed" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!canSetStatus || busy !== null}
                onClick={() => void runStatus("open")}
              >
                {busy === "status" ? <Spinner /> : <PullRequestGlyph.reopen />}
                Reopen
              </Button>
            ) : null}
          </div>
        </header>

        <LinkedPullRequests
          links={pullRequestLinks}
          status={changeRequest.status}
          busy={busy !== null}
          canMerge={blocked === null}
          canClose={canSetStatus}
          onMerge={() => void runMerge()}
          onClose={() => void runStatus("closed")}
          {...(onOpenPullRequest && thread
            ? {
                onOpen: (link: ThreadPullRequestLink) =>
                  onOpenPullRequest({
                    environmentId,
                    projectId: thread.projectId,
                    host: link.host,
                    repository: link.repository,
                    number: link.number,
                  }),
              }
            : {})}
        />
        {open ? <MergePreviewNotice preview={mergePreview} /> : null}
        {errors.length > 0 ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>{open ? "Standing after the merge" : "Standing errors"}</AlertTitle>
            <AlertDescription>
              <WikiPart.ErrorList errors={errors} />
            </AlertDescription>
          </Alert>
        ) : null}

        <WikiPart.Section title={`Amendments (${changeRequest.amendments.length})`}>
          {changeRequest.amendments.length === 0 ? (
            <WikiPart.Muted>No amendments yet.</WikiPart.Muted>
          ) : (
            <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {changeRequest.amendments.toReversed().map((amendment) => (
                <AmendmentRow
                  key={amendment.commit}
                  environmentId={environmentId}
                  wikiId={wikiId}
                  changeRequestId={changeRequestId}
                  amendment={amendment}
                  canRevert={open}
                />
              ))}
            </ol>
          )}
        </WikiPart.Section>

        <WikiPart.Section title={`Files changed (${files.length})`}>
          {files.length === 0 ? (
            <WikiPart.Muted>This change request changes no files.</WikiPart.Muted>
          ) : (
            <div className="flex flex-col gap-4">
              {files.map((change) => (
                <FileChange
                  key={change.file}
                  change={change}
                  onOpen={
                    change.after === null
                      ? undefined
                      : () => onOpenNote(noteNameOfFile(change.file))
                  }
                />
              ))}
            </div>
          )}
        </WikiPart.Section>
      </div>
    </ScrollArea>
  );
}

const NO_LINKS: ReadonlyArray<ThreadPullRequestLink> = [];
const PULL_REQUEST_STATE_LABEL = { open: "Open", merged: "Merged", closed: "Closed" } as const;

/**
 * Astrolabe: the thread's pull requests, each with its state and a way to open it beside, and
 * once they settle, the change request's offer to follow: merge when one merged, close when
 * every one closed without merging. Nothing happens on its own.
 */
function LinkedPullRequests({
  links,
  status,
  busy,
  canMerge,
  canClose,
  onMerge,
  onClose,
  onOpen,
}: {
  readonly links: ReadonlyArray<ThreadPullRequestLink>;
  readonly status: "open" | "merged" | "closed";
  readonly busy: boolean;
  readonly canMerge: boolean;
  readonly canClose: boolean;
  readonly onMerge: () => void;
  readonly onClose: () => void;
  readonly onOpen?: (link: ThreadPullRequestLink) => void;
}) {
  const linked = changeRequestPullRequests(links);
  if (linked.length === 0) return null;
  const nudge = pullRequestNudge(status, links);
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Pull requests" className="flex flex-col gap-1 text-sm">
        {linked.map((link) => {
          const state = link.snapshot?.state ?? null;
          const Glyph =
            state === "merged"
              ? PullRequestGlyph.merged
              : state === "closed"
                ? PullRequestGlyph.closed
                : PullRequestGlyph.pullRequest;
          return (
            <li
              key={`${link.host}:${link.repository}:${link.number}`}
              className="flex items-center gap-2"
            >
              <Glyph aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {`${link.snapshot?.title ?? link.repository} #${link.number}`}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {state === null ? "Not read yet" : PULL_REQUEST_STATE_LABEL[state]}
              </span>
              {onOpen ? (
                <Button size="xs" variant="ghost" onClick={() => onOpen(link)}>
                  Open
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {nudge ? (
        <Alert variant="info">
          {nudge.kind === "merge" ? <PullRequestGlyph.merged /> : <PullRequestGlyph.closed />}
          <AlertTitle>
            {nudge.kind === "merge"
              ? `Pull request #${nudge.pullRequest.number} merged`
              : `Pull request #${nudge.pullRequest.number} closed without merging`}
          </AlertTitle>
          <AlertDescription>
            <span>
              {nudge.kind === "merge"
                ? "Merge these docs too, so the wiki matches the code on main?"
                : "Close this change request too?"}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="mt-1 w-fit"
              disabled={busy || (nudge.kind === "merge" ? !canMerge : !canClose)}
              onClick={nudge.kind === "merge" ? onMerge : onClose}
            >
              {nudge.kind === "merge" ? "Merge docs" : "Close change request"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function MergeButton({
  blocked,
  busy,
  disabled,
  onMerge,
}: {
  readonly blocked: string | null;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onMerge: () => void;
}) {
  const button = (
    <Button size="sm" disabled={blocked !== null || disabled} onClick={onMerge}>
      {busy ? <Spinner /> : <PullRequestGlyph.merged />}
      Merge
    </Button>
  );
  if (blocked === null) return button;
  // A disabled button takes no pointer events, so the reason hangs on a wrapper.
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
        {button}
      </TooltipTrigger>
      <TooltipPopup>{blocked}</TooltipPopup>
    </Tooltip>
  );
}

function MergePreviewNotice({
  preview,
}: {
  readonly preview: { readonly status: string; readonly conflicts: ReadonlyArray<string> };
}) {
  switch (preview.status) {
    case "clean":
      return (
        <Alert variant="success">
          <CircleCheckIcon />
          <AlertDescription>Merges cleanly into main.</AlertDescription>
        </Alert>
      );
    case "conflict":
      return (
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertTitle>Conflicts with main</AlertTitle>
          <AlertDescription>
            {preview.conflicts.length > 0
              ? `Edited on both sides: ${preview.conflicts.join(", ")}. Amend this change request to settle them, then merge.`
              : "Amend this change request to settle the conflict, then merge."}
          </AlertDescription>
        </Alert>
      );
    default:
      return (
        <Alert>
          <CircleCheckIcon />
          <AlertDescription>Main already has these changes.</AlertDescription>
        </Alert>
      );
  }
}

function AmendmentRow({
  environmentId,
  wikiId,
  changeRequestId,
  amendment,
  canRevert,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId;
  readonly amendment: WikiAmendmentSummary;
  readonly canRevert: boolean;
}) {
  const canWrite = useAtomValue(wikiEnvironment.revertAmendment.permissionAtom(environmentId));
  const revert = useWikiCommand(wikiEnvironment.revertAmendment, "Couldn't revert");
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-wrap items-start gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm break-words text-foreground">
          {amendment.reverts ? "Revert: " : null}
          {amendment.subject}
        </span>
        <span className="text-xs break-words text-muted-foreground">
          {`${amendment.actor} · ${formatRelativeTimeLabel(amendment.at)} · ${amendment.files.join(", ")}`}
        </span>
      </div>
      {canRevert ? (
        <Button
          variant="ghost-muted"
          size="xs"
          disabled={!canWrite || busy}
          onClick={async () => {
            setBusy(true);
            await revert({
              environmentId,
              input: { wikiId, changeRequestId, commit: amendment.commit },
            });
            setBusy(false);
          }}
        >
          {busy ? <Spinner /> : null}
          Revert
        </Button>
      ) : null}
    </li>
  );
}

function FileChange({
  change,
  onOpen,
}: {
  readonly change: WikiFileChange;
  readonly onOpen: (() => void) | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const diff = useMemo(
    () =>
      parseDiffFromFile(
        { name: change.file, contents: change.before ?? "" },
        { name: change.file, contents: change.after ?? "" },
      ),
    [change.after, change.before, change.file],
  );
  const label = change.before === null ? "Added" : change.after === null ? "Deleted" : "Changed";
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      <div className="flex min-h-9 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {change.file}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
        {onOpen ? (
          <Button variant="ghost-muted" size="xs" onClick={onOpen}>
            Open
          </Button>
        ) : null}
      </div>
      <FileDiff
        fileDiff={diff}
        options={{
          diffStyle: "unified",
          theme: resolveDiffThemeName(resolvedTheme),
          overflow: "wrap",
          disableFileHeader: true,
        }}
      />
    </div>
  );
}
