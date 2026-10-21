import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  searchWikiListEntries,
  wikiListEntries,
  wikiScopeKey,
  type WikiDocumentEntry,
} from "@t3tools/client-runtime/wikiList";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type ScrollViewProps,
} from "react-native";
import { ScrollViewMarker } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { useProjects } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { useWikiOverviews } from "./useWikiOverviews";
import { WikiListFilters } from "./WikiListFilters";
import { WikiDocumentRow } from "./WikiListRow";
import {
  buildWikiListItems,
  resolveWikiScope,
  wikiScopeChoices,
  type WikiListItem,
} from "./wikisList";

function WikiScrollView(props: ScrollViewProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollViewMarker>
      <ScrollView
        {...props}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentOffset={props.contentOffset ?? { x: 0, y: -insets.top }}
      />
    </ScrollViewMarker>
  );
}

/**
 * Astrolabe: the Wikis tab. Every wiki's documents across the connected servers, under a row
 * counting the open change requests, which the Change requests tab lists, as web's Wikis
 * sidebar does. Adding a wiki or a document stays on the computer for now.
 */
export function WikisScreen() {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs()!;
  const insets = useSafeAreaInsets();
  const { environments } = useWorkspaceState();
  const projects = useProjects();
  const listRef = useRef<LegendListRef>(null);
  const [initialOffset] = useState(() => workspace.getScrollOffset("wikis"));
  const tab = workspace.state.tabs.wikis;
  // Dismissal restores the unfiltered list before restoring its offset.
  const query = tab.searchMode === "resting" ? "" : tab.query;
  const [refreshing, setRefreshing] = useState(false);

  const connected = useMemo(
    () => environments.filter((environment) => environment.connectionState === "connected"),
    [environments],
  );
  const environmentIds = useMemo(
    () => connected.map((environment) => environment.environmentId),
    [connected],
  );
  const { overviews, loading, failures, refresh } = useWikiOverviews(environmentIds);
  const scope = resolveWikiScope(overviews, workspace.wikiScope);
  const scoped =
    overviews.find(
      (overview) => wikiScopeKey(overview.environmentId, overview.wiki.wikiId) === scope,
    ) ?? null;
  const choices = useMemo(
    () =>
      wikiScopeChoices(
        overviews,
        new Map(
          connected.map((environment) => [environment.environmentId, environment.environmentLabel]),
        ),
      ),
    [overviews, connected],
  );
  const projectByKey = useMemo(
    () =>
      new Map<string, EnvironmentProject>(
        projects.map((project) => [scopedProjectKey(project.environmentId, project.id), project]),
      ),
    [projects],
  );
  const items = useMemo(
    () =>
      buildWikiListItems(searchWikiListEntries(wikiListEntries(overviews, scope), query), {
        projects: projectByKey,
      }),
    [overviews, scope, query, projectByKey],
  );

  const openDocument = useCallback(
    (entry: WikiDocumentEntry) => {
      Keyboard.dismiss();
      navigation.navigate("WikiDocument", {
        environmentId: String(entry.environmentId),
        wikiId: String(entry.wiki.wikiId),
        name: entry.name,
      });
    },
    [navigation],
  );
  // Change requests are the Change requests tab's; this row leads there.
  const openChanges = useCallback(() => {
    Keyboard.dismiss();
    workspace.dispatch({ type: "select", tab: "pullRequests" });
  }, [workspace]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const renderItem = useCallback(
    ({ item }: { readonly item: WikiListItem }) => {
      switch (item.type) {
        case "changes-link":
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.count} open ${item.count === 1 ? "change" : "changes"}`}
              accessibilityHint="Shows them in Change requests."
              onPress={openChanges}
              className="flex-row items-center gap-2 px-4 py-3 active:opacity-60"
            >
              <SymbolView
                name={PullRequestGlyph.pullRequest}
                size={15}
                tintColorClassName="accent-icon"
              />
              <Text className="flex-1 text-sm font-t3-medium text-foreground-muted">
                {`Open changes · ${item.count}`}
              </Text>
              <SymbolView name="chevron.right" size={13} tintColorClassName="accent-icon" />
            </Pressable>
          );
        case "settled-shelf":
        case "section":
        case "change":
          return null;
        case "document":
          return (
            <WikiDocumentRow
              entry={item.entry}
              project={item.project}
              showTrailingDivider={item.showTrailingDivider}
              onSelect={openDocument}
            />
          );
      }
    },
    [openDocument, openChanges],
  );

  const previousSearchMode = useRef(tab.searchMode);
  useEffect(() => {
    const restoringSearch =
      previousSearchMode.current !== "resting" && tab.searchMode === "resting";
    previousSearchMode.current = tab.searchMode;
    if (restoringSearch)
      void listRef.current?.scrollToOffset({
        offset: tab.scrollOffset - (Platform.OS === "ios" ? insets.top : 0),
        animated: false,
      });
  }, [tab.searchMode, tab.scrollOffset, insets.top]);

  const serverName = (environmentId: string) =>
    environments.find((environment) => environment.environmentId === environmentId)
      ?.environmentLabel ?? "Environment";
  const empty =
    environments.length === 0
      ? {
          title: "Connect an environment",
          detail: "Add an environment in Settings to browse its wikis.",
        }
      : connected.length === 0
        ? { title: "Environment offline", detail: "Reconnect to load your wikis." }
        : overviews.length === 0 && failures.length === connected.length
          ? {
              title: "Couldn't load wikis",
              detail: failures.map((failure) => failure.message).join("\n"),
            }
          : overviews.length === 0
            ? { title: "No wikis yet", detail: "Add a wiki from Astrolabe on your computer." }
            : query
              ? { title: "No results", detail: `No documents matching "${query}".` }
              : scoped
                ? {
                    title: `No documents in ${scoped.wiki.name} yet`,
                    detail:
                      "Choose another wiki, or add a document from Astrolabe on your computer.",
                  }
                : {
                    title: "No documents yet",
                    detail: "Add a document from Astrolabe on your computer.",
                  };

  return (
    <View className="flex-1 bg-screen">
      <LegendList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        renderItem={renderItem}
        // A row with a one-line title measures about 82pt.
        estimatedItemSize={82}
        drawDistance={1_000}
        recycleItems
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            // Place the 60pt native refresh control in the revealed pull-down space.
            progressViewOffset={Platform.OS === "ios" ? 60 : undefined}
          />
        }
        alwaysBounceVertical
        renderScrollComponent={Platform.OS === "ios" ? WikiScrollView : undefined}
        contentInsetAdjustmentBehavior="never"
        contentInset={Platform.OS === "ios" ? { top: insets.top } : undefined}
        contentInsetStartAdjustment={Platform.OS === "ios" ? insets.top : 0}
        initialScrollOffset={
          initialOffset > 0 ? initialOffset - (Platform.OS === "ios" ? insets.top : 0) : undefined
        }
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, workspace.bottomClearance),
        }}
        onScroll={(event) =>
          workspace.recordScrollOffset(
            "wikis",
            Math.max(
              0,
              event.nativeEvent.contentOffset.y + (Platform.OS === "ios" ? insets.top : 0),
            ),
          )
        }
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <>
            {overviews.length > 0 ? (
              <WikiListFilters
                choices={choices}
                scope={scope}
                onScopeChange={(next) => {
                  workspace.setWikiScope(next);
                  void listRef.current?.scrollToOffset({
                    offset: Platform.OS === "ios" ? -insets.top : 0,
                    animated: false,
                  });
                }}
              />
            ) : null}
            {failures.length > 0 && overviews.length > 0 ? (
              <Text className="px-4 py-3 text-sm text-foreground-muted">
                {failures
                  .map((failure) => `${serverName(failure.environmentId)}: ${failure.message}`)
                  .join("\n")}
              </Text>
            ) : null}
          </>
        }
        ListEmptyComponent={
          loading && overviews.length === 0 ? (
            <View className="items-center py-12">
              <AppActivityIndicator
                colorClassName="accent-icon"
                accessibilityLabel="Loading wikis"
              />
            </View>
          ) : (
            <View className="px-8 py-12">
              <EmptyState title={empty.title} detail={empty.detail} variant="plain" />
            </View>
          )
        }
      />
    </View>
  );
}
