import { useNavigation } from "@react-navigation/native";
import {
  searchWikiListEntries,
  wikiListEntries,
  wikiScopeKey,
  type WikiChangeEntry,
} from "@t3tools/client-runtime/wikiList";
import { useCallback, useMemo, useState } from "react";
import { Keyboard, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useWorkspaceState } from "../../state/workspace";
import {
  ThreadListV2DisclosureDivider,
  ThreadListV2SectionDivider,
} from "../threads/thread-list-v2-items";
import { useWikiOverviews } from "./useWikiOverviews";
import { WikiChangeRow } from "./WikiListRow";
import { buildWikiChangeItems } from "./wikisList";

/**
 * Astrolabe: the wikis' change requests at the top of the Change requests tab, a group of their
 * own above the pull requests, as web lists them: the open ones under "Wiki changes", then the
 * merged and closed on a folded shelf. The tab's project filter narrows them to one wiki
 * (`scope`), and its search by title. Nothing without any, unless they are the whole list.
 */
export function WikiChangesSection({
  query,
  scope,
  pullRequestsFollow = true,
}: {
  readonly query: string;
  /** The one wiki to list, or null for every wiki. */
  readonly scope: string | null;
  /** Whether pull requests follow below, under a rule of their own. */
  readonly pullRequestsFollow?: boolean;
}) {
  const navigation = useNavigation();
  const { environments } = useWorkspaceState();
  const [settledExpanded, setSettledExpanded] = useState(false);
  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connectionState === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const { overviews } = useWikiOverviews(environmentIds);
  const searching = query.length > 0;
  const items = useMemo(() => {
    const entries = searchWikiListEntries(wikiListEntries(overviews, scope), query);
    return buildWikiChangeItems(
      { ...entries, documents: [] },
      { settledExpanded: settledExpanded || searching },
    );
  }, [overviews, scope, query, searching, settledExpanded]);
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
  if (items.length === 0) {
    if (pullRequestsFollow) return null;
    const wiki = overviews.find(
      (overview) => wikiScopeKey(overview.environmentId, overview.wiki.wikiId) === scope,
    );
    return (
      <Text className="px-4 py-6 text-center text-sm text-foreground-muted">
        {searching
          ? "No change requests found"
          : wiki
            ? `No change requests in ${wiki.wiki.name} yet`
            : "No wiki change requests yet"}
      </Text>
    );
  }
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
