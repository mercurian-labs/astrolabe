/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type {
  EnvironmentId,
  ThreadPullRequestLink,
  WikiAmendmentSummary,
  WikiChangeRequest,
  WikiChangeRequestId,
  ProjectRootId,
  WikiSummary,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  changeRequestPullRequests,
  pullRequestNudge,
  unmergedPullRequests,
} from "@t3tools/client-runtime/wikiPullRequests";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { ensureLocalApi } from "~/localApi";
import { workspace } from "~/panes/workspace";
import { useThreadShell } from "~/state/entities";
import { projectRootsEnvironment } from "~/state/projectRoots";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { repositoryTabKey } from "../repositories/repositoryTabs";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { projectRootFileTab } from "./projectRootFileTab";
import { changeRequestProblems, hasUnpublishedWork, wikiTerms } from "./wiki.logic";
import { useWikiCommand } from "./wikiEnvironment";
import { WikiPart } from "./WikiParts";

const NO_LINKS: ReadonlyArray<ThreadPullRequestLink> = [];
const PULL_REQUEST_STATE_LABEL = { open: "Open", merged: "Merged", closed: "Closed" } as const;

export interface WikiPullRequestChange {
  readonly wiki: WikiSummary;
  readonly changeRequest: WikiChangeRequest;
}

/** The pull requests of the thread that wrote a wiki change, which its docs describe. */
function useCodePullRequests(
  environmentId: EnvironmentId,
  change: WikiPullRequestChange | null,
): ReadonlyArray<ThreadPullRequestLink> {
  const threadId = change?.changeRequest.threadId ?? null;
  const thread = useThreadShell(threadId === null ? null : scopeThreadRef(environmentId, threadId));
  return thread?.pullRequests ?? NO_LINKS;
}

/**
 * Asks before a wiki's pull request merges ahead of the code it describes; true to go on. Every
 * other pull request goes on without asking.
 */
export function useConfirmWikiMerge(
  environmentId: EnvironmentId,
  change: WikiPullRequestChange | null,
) {
  const links = useCodePullRequests(environmentId, change);
  return async () => {
    const waiting = unmergedPullRequests(links);
    if (change === null || waiting.length === 0) return true;
    const names = waiting.map((link) => `#${link.number}`).join(", ");
    return ensureLocalApi().dialogs.confirm(
      `${waiting.length === 1 ? "Pull request" : "Pull requests"} ${names} ${waiting.length === 1 ? "hasn't" : "haven't"} merged yet, so these docs would describe code that isn't on main. Merge them anyway?`,
    );
  };
}

/**
 * A host wiki's reading of its pull request, as a tab of the pull request's screen: who amended
 * what, the notes it touches, what stands after the merge, and the code it describes.
 */
export function WikiPullRequestTab({
  environmentId,
  change,
  scrollerRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly change: WikiPullRequestChange;
  readonly scrollerRef: (node: HTMLElement | null) => void;
}) {
  const { wiki, changeRequest } = change;
  const { wikiId, changeRequestId } = changeRequest;
  const target = { wikiId, changeRequestId };
  const terms = wikiTerms(wiki);
  const detail = useEnvironmentQuery(
    wikiEnvironment.changeRequest({ environmentId, input: target }),
  );
  const links = useCodePullRequests(environmentId, change);
  const navigate = useNavigate();
  const canPublish = useAtomValue(
    wikiEnvironment.publishChangeRequest.permissionAtom(environmentId),
  );
  const canSetStatus = useAtomValue(
    wikiEnvironment.setChangeRequestStatus.permissionAtom(environmentId),
  );
  const publish = useWikiCommand(wikiEnvironment.publishChangeRequest, "Couldn't publish");
  const setStatus = useWikiCommand(wikiEnvironment.setChangeRequestStatus, "Couldn't update");
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await action();
    setBusy(false);
  };

  const open = changeRequest.status === "open";
  const files = detail.data?.files ?? [];
  const errors = detail.data === null ? [] : changeRequestProblems(detail.data);
  // A document opens as its Projects file, in the folder of the project root this is.
  const roots = useEnvironmentQuery(
    wiki.projectId === undefined
      ? null
      : projectRootsEnvironment.list({ environmentId, input: { projectId: wiki.projectId } }),
  );
  const openNote = (file: string) => {
    const tab =
      wiki.projectId === undefined || wiki.rootKey === undefined || roots.data === null
        ? null
        : projectRootFileTab({
            environmentId,
            projectId: wiki.projectId,
            roots: roots.data.roots,
            rootKey: wiki.rootKey,
            file,
          });
    if (tab === null) {
      toastManager.add({ type: "warning", title: `${file} isn't on disk here` });
      return;
    }
    workspace.open(repositoryTabKey(tab));
  };

  return (
    <div
      ref={scrollerRef}
      className="topbar-scroll-fade scrollbar-gutter-both h-full min-h-0 overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pt-6 pb-24">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1">
            {`In ${wiki.name} · opened by ${changeRequest.createdBy} ${formatRelativeTimeLabel(changeRequest.createdAt)}`}
          </span>
          {changeRequest.threadId ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                const threadId = changeRequest.threadId;
                if (threadId) {
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: { environmentId, threadId },
                  });
                }
              }}
            >
              <MessagesSquareIcon />
              Open thread
            </Button>
          ) : null}
        </div>

        {open && hasUnpublishedWork(changeRequest) ? (
          <Alert variant="info">
            <TriangleAlertIcon />
            <AlertTitle>Some of this isn't on the host yet</AlertTitle>
            <AlertDescription>
              <span>{`Merging now leaves it out of this ${terms.singular}.`}</span>
              <Button
                size="sm"
                variant="outline"
                className="mt-1 w-fit"
                disabled={!canPublish || busy}
                onClick={() => void run(() => publish({ environmentId, input: target }))}
              >
                {busy ? <Spinner /> : null}
                Publish now
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <LinkedPullRequests
          links={links}
          status={changeRequest.status}
          noun={terms.singular}
          busy={busy}
          canClose={canSetStatus}
          onClose={() =>
            void run(() => setStatus({ environmentId, input: { ...target, status: "closed" } }))
          }
        />

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

        <WikiPart.Section title={`Notes changed (${files.length})`}>
          {files.length === 0 ? (
            <WikiPart.Muted>
              {detail.data === null ? "Reading…" : `This ${terms.singular} changes no files.`}
            </WikiPart.Muted>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {files.map((change) => (
                <li key={change.file} className="flex min-h-9 items-center gap-2 px-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {change.file}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {change.before === null
                      ? "Added"
                      : change.after === null
                        ? "Deleted"
                        : "Changed"}
                  </span>
                  {change.after === null ? null : (
                    <Button variant="ghost-muted" size="xs" onClick={() => openNote(change.file)}>
                      Open
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </WikiPart.Section>
      </div>
    </div>
  );
}

/**
 * The thread's pull requests, each with its state, and once they settle, the change's offer to
 * follow: close when every one closed without merging. A merge happens from the pull request's
 * own header.
 */
function LinkedPullRequests({
  links,
  status,
  noun,
  busy,
  canClose,
  onClose,
}: {
  readonly links: ReadonlyArray<ThreadPullRequestLink>;
  readonly status: "open" | "merged" | "closed";
  readonly noun: string;
  readonly busy: boolean;
  readonly canClose: boolean;
  readonly onClose: () => void;
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
                ? "Merge these docs too, so they match the code on main."
                : `Close this ${noun} too?`}
            </span>
            {nudge.kind === "merge" ? null : (
              <Button
                size="sm"
                variant="outline"
                className="mt-1 w-fit"
                disabled={busy || !canClose}
                onClick={onClose}
              >
                {`Close ${noun}`}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function AmendmentRow({
  environmentId,
  wikiId,
  changeRequestId,
  amendment,
  canRevert,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: ProjectRootId;
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
            const outcome = await revert({
              environmentId,
              input: { wikiId, changeRequestId, commit: amendment.commit },
            });
            setBusy(false);
            const notes = outcome.ok ? (outcome.value.canvases ?? []) : [];
            if (notes.length > 0) {
              toastManager.add({
                type: "info",
                title: "Reverted, and the canvas was fitted to later work",
                description: notes.flatMap((each) => each.notes).join(" "),
              });
            }
          }}
        >
          {busy ? <Spinner /> : null}
          Revert
        </Button>
      ) : null}
    </li>
  );
}
