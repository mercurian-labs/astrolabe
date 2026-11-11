import type {
  EnvironmentId,
  ThreadPullRequestLink,
  WikiChangeRequest,
  WikiSummary,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { unmergedPullRequests } from "@t3tools/client-runtime/wikiPullRequests";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { ensureLocalApi } from "~/localApi";
import { workspace } from "~/panes/workspace";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { changeRequestProblems, hasUnpublishedWork, wikiTerms } from "./wiki.logic";
import { AmendmentRow, LinkedPullRequests, NO_LINKS } from "./WikiChangeRequestView";
import { useWikiCommand } from "./wikiEnvironment";
import { wikiTabKey } from "./wikiTabs";
import { WikiPart } from "./WikiParts";

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
  const openNote = (file: string) =>
    workspace.open(
      wikiTabKey({
        kind: "note",
        environmentId,
        wikiId,
        file,
        // An open change's notes read inside it; a merged or closed one's from main.
        changeRequestId: open ? changeRequestId : undefined,
      }),
    );

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
          canMerge={false}
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
