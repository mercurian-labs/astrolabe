import { XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { isMacPlatform } from "~/lib/utils";
import { startDrag } from "~/panes/drag";
import {
  anchorRow,
  rangeToRow,
  rowsActedOn,
  toggleRow,
  useRowSelectionStore,
} from "~/sidebarRowSelection";
import { rowClickIntent, type RowClick } from "~/tabNavigation.logic";
import { useWorkspaceFocusedKey } from "~/panes/workspace";
import { placeChangeRequestTabs, showChangeRequestTab } from "../pullRequest/pullRequestWorkspace";
import { Button } from "../ui/button";
import { CountedSectionHeader } from "./CountedSectionHeader";
import { TooltipProvider } from "../ui/tooltip";
import { useWikiOverviews } from "../wiki/wikiEnvironment";
import { changeRequestWikiScope } from "../wiki/wikiScope";
import { WikiChangeRow, type WikiRowActions } from "../wiki/WikiSidebar";
import {
  searchWikiSidebarItems,
  wikiScopeKey,
  wikiSidebarItems,
  wikiTabKey,
  type WikiChangeItem,
  type WikiTab,
} from "../wiki/wikiTabs";

/** The wiki rows' share of the sidebars' row selection (`sidebarRowSelection`). */
const SELECTION_SECTION = "change-requests:wikis";
const NO_KEYS: readonly string[] = [];

const isOpenChange = (item: WikiChangeItem) =>
  item.changeRequest.status === "open" && !item.changeRequest.draft;
const isDraft = (item: WikiChangeItem) =>
  item.changeRequest.status === "open" && item.changeRequest.draft;

/**
 * Wiki change requests as their own group in the Change Requests sidebar: the person's drafts, open
 * ones as cards, then merged and closed ones on a folded shelf. They follow the section's project filter (one wiki or
 * all) and search (by title); a click shows one in the focused pane's front tab, like a PR row.
 */
export function WikiChangesGroup({
  query,
  alone = false,
}: {
  readonly query: string;
  /** Whether the group is the whole list, so it says so when it has nothing to show. */
  readonly alone?: boolean;
}) {
  const { overviews } = useWikiOverviews();
  const [scope, setScope] = changeRequestWikiScope.useScope(overviews);
  const focusedKey = useWorkspaceFocusedKey();
  const [draftsExpanded, setDraftsExpanded] = useState(true);
  const [openExpanded, setOpenExpanded] = useState(true);
  const [settledExpanded, setSettledExpanded] = useState(false);
  const lists = wikiSidebarItems(overviews, scope);
  const searching = query.trim().length > 0;
  const matches = searching
    ? searchWikiSidebarItems({ ...lists, documents: [] }, query).flatMap((entry) =>
        entry.kind === "change" ? [entry.item] : [],
      )
    : null;
  const drafts = matches ? matches.filter(isDraft) : lists.drafts;
  const open = matches ? matches.filter(isOpenChange) : lists.changes;
  const settled = matches
    ? matches.filter((item) => item.changeRequest.status !== "open")
    : lists.settled;
  const scoped =
    overviews.find(
      (overview) => wikiScopeKey(overview.environmentId, overview.wiki.wikiId) === scope,
    ) ?? null;

  const shown = useRef<readonly string[]>([]);
  const shownItems = [
    ...(draftsExpanded ? drafts : []),
    ...(openExpanded ? open : []),
    ...(settledExpanded || searching ? settled : []),
  ];
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the shown row keys for range selection in the row handlers
  useLayoutEffect(() => {
    shown.current = shownItems.map((item) => item.key);
  });
  const selectedKeys = useRowSelectionStore((store) =>
    store.selection.section === SELECTION_SECTION ? store.selection.keys : NO_KEYS,
  );
  const selecting = selectedKeys.length > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window Escape listener that clears the row selection while rows are selected
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      useRowSelectionStore.getState().change((now) => ({ ...now, keys: [] }));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting]);

  const onOpen = (tab: WikiTab, event: RowClick | null) => {
    const intent =
      event === null ? "replace" : rowClickIntent(event, isMacPlatform(navigator.platform));
    const key = wikiTabKey(tab);
    const { change } = useRowSelectionStore.getState();
    if (intent === "mod") {
      change((now) => toggleRow(now, SELECTION_SECTION, key));
      return;
    }
    if (intent === "range") {
      change((now) => rangeToRow(now, SELECTION_SECTION, key, shown.current));
      return;
    }
    change(() => anchorRow(SELECTION_SECTION, key));
    showChangeRequestTab(key, intent === "new-tab" ? "new-tab" : "replace");
  };
  const actedOn = (tab: WikiTab) => {
    const { selection } = useRowSelectionStore.getState();
    return rowsActedOn(selection, SELECTION_SECTION, wikiTabKey(tab), shown.current);
  };
  const actions: WikiRowActions = {
    drag: (tab, event) => {
      const carried = actedOn(tab);
      const key = wikiTabKey(tab);
      startDrag(
        event,
        {
          key,
          keys: [],
          place: (paneId, drop) => placeChangeRequestTabs(carried, key, paneId, drop),
        },
        event.currentTarget.getAttribute("aria-label") ?? "",
        carried.length > 1 ? carried.length : 0,
      );
    },
    openAll: (tab) => {
      for (const key of actedOn(tab)) showChangeRequestTab(key, "new-tab");
    },
    count: (tab) => actedOn(tab).length,
  };

  const none =
    (lists.drafts.length === 0 && lists.changes.length === 0 && lists.settled.length === 0) ||
    (searching && drafts.length === 0 && open.length === 0 && settled.length === 0);
  if (none) {
    if (!alone) return null;
    return (
      <p role="status" className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
        {searching
          ? "No change requests found"
          : scoped
            ? `No change requests in ${scoped.wiki.name} yet`
            : "No wiki change requests yet"}
      </p>
    );
  }
  const row = (item: WikiChangeItem) => (
    <WikiChangeRow
      key={item.key}
      item={item}
      active={focusedKey === item.key}
      selected={selectedKeys.includes(item.key)}
      actions={actions}
      onOpen={onOpen}
    />
  );
  return (
    <TooltipProvider delay={150} closeDelay={0} timeout={400}>
      <ul
        role="presentation"
        aria-label="Wiki changes"
        className="relative flex flex-col gap-px pb-2"
      >
        {drafts.length > 0 ? (
          <>
            <li className="mx-0.5 flex h-8 list-none items-center gap-1">
              <CountedSectionHeader
                onClick={() => setDraftsExpanded((expanded) => !expanded)}
                expanded={draftsExpanded}
                tone="muted"
                label="Your drafts"
                count={drafts.length}
              />
            </li>
            {draftsExpanded ? drafts.map(row) : null}
          </>
        ) : null}
        <li className="mx-0.5 flex h-8 list-none items-center gap-1">
          <CountedSectionHeader
            onClick={() => setOpenExpanded((expanded) => !expanded)}
            expanded={openExpanded}
            tone="muted"
            label={scoped ? `Wiki changes · ${scoped.wiki.name}` : "Wiki changes"}
            count={open.length}
          />
          {scoped ? (
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={`Show every wiki's changes, not only ${scoped.wiki.name}'s`}
              onClick={() => setScope(null)}
            >
              <XIcon />
            </Button>
          ) : null}
        </li>
        {openExpanded ? open.map(row) : null}
        {settled.length > 0 ? (
          <>
            <li className="mx-0.5 h-8 list-none">
              <CountedSectionHeader
                onClick={() => setSettledExpanded((expanded) => !expanded)}
                expanded={settledExpanded || searching}
                tone="muted"
                label="Merged and closed"
                count={settled.length}
              />
            </li>
            {settledExpanded || searching ? settled.map(row) : null}
          </>
        ) : null}
      </ul>
    </TooltipProvider>
  );
}
