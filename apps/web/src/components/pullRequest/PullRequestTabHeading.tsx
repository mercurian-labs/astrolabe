import { canEditPullRequestChangeRequest } from "@t3tools/client-runtime/pull-request-editing";
import type { PullRequestDetail, PullRequestState } from "@t3tools/contracts";
import { ListIcon, PencilIcon } from "lucide-react";

import { TabHeader } from "~/panes/TabHeader";
import { resolvePullRequestState } from "./pullRequestPresentation";

/**
 * Astrolabe: a pull request's header row in the shared panes, in place of T3 Code's crumbs, with
 * the panel's own actions beside it in the same row (`PullRequestDetailPanel`). An open pull
 * request's state reads as status; a merged or closed one's shows as the panel's badge.
 */
export function PullRequestTabHeading({
  reference: { repository, number },
  summary,
  detail,
  onEditTitle,
  onBack,
}: {
  readonly reference: { readonly repository: string; readonly number: number };
  /** What is known before the detail loads, if anything. */
  readonly summary: {
    readonly title: string;
    readonly state: PullRequestState;
    readonly isDraft?: boolean | undefined;
  } | null;
  readonly detail: PullRequestDetail | null;
  readonly onEditTitle: () => void;
  readonly onBack: (() => void) | undefined;
}) {
  const title = summary?.title ?? null;
  const state = summary?.state ?? null;
  const editable = detail !== null && canEditPullRequestChangeRequest(detail);
  return (
    // The panel's actions take the row's end, so the gutter there is theirs.
    <TabHeader.Root className="pr-0">
      <TabHeader.Title label="Pull request" parent={repository} keepParent>
        {title === null ? `#${number}` : `#${number} ${title}`}
      </TabHeader.Title>
      {state === "open" ? (
        <TabHeader.Status>
          {resolvePullRequestState({ state, isDraft: summary?.isDraft ?? false }).label}
        </TabHeader.Status>
      ) : null}
      {editable || onBack ? (
        <TabHeader.Actions>
          {editable ? (
            <TabHeader.Action label="Edit title" onClick={onEditTitle}>
              <PencilIcon className="size-4" />
            </TabHeader.Action>
          ) : null}
          {onBack ? (
            <TabHeader.Action label="This thread's pull requests" onClick={onBack}>
              <ListIcon className="size-4" />
            </TabHeader.Action>
          ) : null}
        </TabHeader.Actions>
      ) : null}
    </TabHeader.Root>
  );
}
