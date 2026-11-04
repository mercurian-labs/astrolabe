import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { BookOpenIcon } from "lucide-react";

import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useOpenWiki } from "./useOpenWiki";

/** The wikis this thread's project is linked to, in the chat header. */
export function LinkedWikiChips({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const list = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const openWiki = useOpenWiki();
  const wikis = (list.data?.wikis ?? []).filter((wiki) => wiki.projectIds.includes(projectId));
  if (wikis.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 max-sm:hidden">
      {wikis.map((wiki) => (
        <Tooltip key={wiki.wikiId}>
          <TooltipTrigger
            render={
              <Badge
                variant="outline"
                size="sm"
                render={
                  <button
                    type="button"
                    aria-label={`Open the wiki ${wiki.name}`}
                    onClick={() => void openWiki(environmentId, wiki.wikiId)}
                  />
                }
              />
            }
          >
            <BookOpenIcon aria-hidden />
            <span className="max-w-32 truncate">{wiki.name}</span>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {`Agents in this project search ${wiki.name} first and write their plans there.`}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
