import { useNavigation } from "@react-navigation/native";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  searchWikiListEntries,
  wikiListEntries,
  type WikiChangeEntry,
} from "@t3tools/client-runtime/wikiList";
import { useCallback, useMemo, useState } from "react";
import { Keyboard, View } from "react-native";

import { scopedProjectKey } from "../../lib/scopedEntities";
import { useProjects } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import {
  ThreadListV2DisclosureDivider,
  ThreadListV2SectionDivider,
} from "../threads/thread-list-v2-items";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { useWikiOverviews } from "./useWikiOverviews";
import { WikiChangeRow } from "./WikiListRow";
import { buildWikiChangeItems, resolveWikiScope } from "./wikisList";

/**
 * Astrolabe: the wikis' change requests at the top of the Change requests tab, a group of their
 * own above the pull requests, as web lists them: the open ones under "Wiki changes", then the
 * merged and closed on a folded shelf. The Wikis tab's filter narrows them, and the tab's search
 * by title. Nothing without any.
 */
export function WikiChangesSection({
  query,
  pullRequestsFollow = true,
}: {
  readonly query: string;
  /** Whether pull requests follow below, under a rule of their own. */
  readonly pullRequestsFollow?: boolean;
}) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs()!;
  const { environments } = useWorkspaceState();
  const projects = useProjects();
  const [settledExpanded, setSettledExpanded] = useState(false);
  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connectionState === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const { overviews } = useWikiOverviews(environmentIds);
  const scope = resolveWikiScope(overviews, workspace.wikiScope);
  const projectByKey = useMemo(
    () =>
      new Map<string, EnvironmentProject>(
        projects.map((project) => [scopedProjectKey(project.environmentId, project.id), project]),
      ),
    [projects],
  );
  const searching = query.length > 0;
  const items = useMemo(() => {
    const entries = searchWikiListEntries(wikiListEntries(overviews, scope), query);
    return buildWikiChangeItems(
      { ...entries, documents: [] },
      { settledExpanded: settledExpanded || searching, projects: projectByKey },
    );
  }, [overviews, scope, query, searching, settledExpanded, projectByKey]);
  const openChangeRequest = useCallback(
    (entry: WikiChangeEntry) => {
      Keyboard.dismiss();
      navigation.navigate("WikiChangeRequest", {
        environmentId: String(entry.environmentId),
        wikiId: String(entry.wiki.wikiId),
        changeRequestId: String(entry.changeRequest.changeRequestId),
      });
    },
    [navigation],
  );
  if (items.length === 0) return null;
  return (
    <View accessibilityLabel="Wiki changes">
      {items.map((item) => {
        switch (item.type) {
          case "section":
            return <ThreadListV2SectionDivider key={item.key} label={item.label} />;
          case "settled-shelf":
            return (
              <ThreadListV2DisclosureDivider
                key={item.key}
                label={`Merged and closed · ${item.count}`}
                expanded={item.expanded}
                onToggle={() => setSettledExpanded((expanded) => !expanded)}
                accessibilityLabel={`${item.count} merged and closed ${item.count === 1 ? "change request" : "change requests"}`}
                accessibilityHint={`${item.expanded ? "Collapses" : "Expands"} the merged and closed change requests.`}
              />
            );
          case "change":
            return (
              <WikiChangeRow
                key={item.key}
                entry={item.entry}
                project={item.project}
                showTrailingDivider={item.showTrailingDivider}
                onSelect={openChangeRequest}
              />
            );
          default:
            return null;
        }
      })}
      {pullRequestsFollow ? <ThreadListV2SectionDivider label="Pull requests" /> : null}
    </View>
  );
}
