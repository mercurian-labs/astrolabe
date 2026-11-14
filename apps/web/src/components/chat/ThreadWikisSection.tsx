import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { BookOpenIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { useEnvironmentChangeRequests } from "~/state/changeGroups";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { CHANGE_GROUP_MEMBER_STATE_LABELS } from "../changeRequests/groups/changeGroupPresentation";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useOpenWiki, useOpenWikiTab } from "../wiki/useOpenWiki";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

/**
 * Astrolabe: the wikis the thread's project is linked to, each with the change request this
 * thread has on it. Nothing for a project with no linked wiki.
 */
export function ThreadWikisSection({
  environmentId,
  projectId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}) {
  const list = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const changeRequests = useEnvironmentChangeRequests(environmentId);
  const openWiki = useOpenWiki();
  const openWikiTab = useOpenWikiTab();
  const wikis = (list.data?.wikis ?? []).filter((wiki) => wiki.projectIds.includes(projectId));
  if (wikis.length === 0) return null;
  return (
    <ThreadDetailsSection headingId="thread-details-wikis-heading" title="Wikis">
      <div className="flex flex-col">
        {wikis.map((wiki) => (
          <div key={wiki.wikiId} className="flex flex-col">
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    type="button"
                    variant="ghost"
                    size="sm"
                    part="row"
                    aria-label={`Open the wiki ${wiki.name}`}
                    onClick={() => void openWiki(environmentId, wiki.wikiId)}
                  />
                }
              >
                <BookOpenIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-left",
                    THREAD_DETAILS_PANEL_LABEL_CLASS,
                  )}
                >
                  {wiki.name}
                </span>
              </TooltipTrigger>
              <TooltipPopup side="top">
                {`Agents in this project search ${wiki.name} first and write their plans there.`}
              </TooltipPopup>
            </Tooltip>
            <div className="flex flex-col ps-6">
              {changeRequests
                .flatMap((member) =>
                  member.ref.kind === "wiki-change-request" &&
                  member.ref.wikiId === wiki.wikiId &&
                  member.threadId === threadId
                    ? [{ member, ref: member.ref }]
                    : [],
                )
                .map(({ member, ref }) => (
                  <ThreadDetailsControl
                    key={member.key}
                    type="button"
                    variant="ghost"
                    size="sm"
                    part="row"
                    aria-label={`${member.title}, ${CHANGE_GROUP_MEMBER_STATE_LABELS[member.state]}`}
                    onClick={() =>
                      openWikiTab({
                        kind: "change-request",
                        environmentId,
                        wikiId: ref.wikiId,
                        changeRequestId: ref.changeRequestId,
                      })
                    }
                  >
                    <PullRequestGlyph.pullRequest className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-left",
                        THREAD_DETAILS_PANEL_LABEL_CLASS,
                      )}
                    >
                      {member.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {CHANGE_GROUP_MEMBER_STATE_LABELS[member.state]}
                    </span>
                  </ThreadDetailsControl>
                ))}
            </div>
          </div>
        ))}
      </div>
    </ThreadDetailsSection>
  );
}
