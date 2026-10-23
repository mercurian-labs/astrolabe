import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

export type WorkspaceTab = "threads" | "pullRequests" | "wikis" | "repositories";

/** The roots in the order the tab bar shows them. */
export const WORKSPACE_TABS: ReadonlyArray<WorkspaceTab> = [
  "threads",
  "pullRequests",
  "wikis",
  "repositories",
];

/**
 * The roots iPhone shows. Wikis and Repositories wait on their own iPad sidebar design, so the
 * iPad sidebar picker, and the tab bar a compact iPad window shows, keep Agents and Changes.
 */
export function workspaceTabsFor(device: "phone" | "pad"): ReadonlyArray<WorkspaceTab> {
  return device === "pad"
    ? WORKSPACE_TABS.filter((tab) => tab !== "wikis" && tab !== "repositories")
    : WORKSPACE_TABS;
}

/** Each root's name, and the label its search goes by. */
export const WORKSPACE_TAB_LABELS: Readonly<
  Record<WorkspaceTab, { readonly title: string; readonly search: string }>
> = {
  threads: { title: "Agents", search: "Search threads" },
  // Astrolabe: pull requests and the wikis' change requests, as web's Change Requests section.
  pullRequests: { title: "Changes", search: "Search changes" },
  wikis: { title: "Wikis", search: "Search wikis" },
  repositories: { title: "Repositories", search: "Search files" },
};

/** Each root's glyph where the app draws its own tabs rather than UIKit's. */
export const WORKSPACE_TAB_ICONS: Readonly<Record<WorkspaceTab, AppSymbolName>> = {
  threads: "text.bubble",
  pullRequests: PullRequestGlyph.pullRequest,
  wikis: "book",
  repositories: "folder",
};
export type WorkspaceSearchMode = "resting" | "active" | "expanded";

export interface WorkspaceTabState {
  readonly query: string;
  readonly searchMode: WorkspaceSearchMode;
  readonly scrollOffset: number;
  readonly searchEntryOffset: number;
}

export interface WorkspaceTabsState {
  readonly selectedTab: WorkspaceTab;
  readonly selectionRevision: number;
  readonly tabs: Readonly<Record<WorkspaceTab, WorkspaceTabState>>;
}

function emptyTab(): WorkspaceTabState {
  return { query: "", searchMode: "resting", scrollOffset: 0, searchEntryOffset: 0 };
}

export function initialWorkspaceTabsState(): WorkspaceTabsState {
  return {
    selectedTab: "threads",
    selectionRevision: 0,
    tabs: {
      threads: emptyTab(),
      pullRequests: emptyTab(),
      wikis: emptyTab(),
      repositories: emptyTab(),
    },
  };
}

export type WorkspaceTabsAction =
  | { readonly type: "select"; readonly tab: WorkspaceTab }
  | { readonly type: "search"; readonly tab?: WorkspaceTab }
  | { readonly type: "query"; readonly query: string; readonly tab?: WorkspaceTab }
  | { readonly type: "expand"; readonly tab?: WorkspaceTab }
  | { readonly type: "cancel"; readonly tab?: WorkspaceTab }
  | { readonly type: "scroll"; readonly tab: WorkspaceTab; readonly offset: number };

export function workspaceTabsReducer(
  state: WorkspaceTabsState,
  action: WorkspaceTabsAction,
): WorkspaceTabsState {
  if (action.type === "select")
    return action.tab === state.selectedTab
      ? state
      : {
          ...state,
          selectedTab: action.tab,
          selectionRevision: state.selectionRevision + 1,
        };
  const tab = action.tab ?? state.selectedTab;
  const current = state.tabs[tab];
  let next: WorkspaceTabState;
  switch (action.type) {
    case "search":
      next = {
        ...current,
        searchMode: "active",
        searchEntryOffset:
          current.searchMode === "resting" ? current.scrollOffset : current.searchEntryOffset,
      };
      break;
    case "query":
      next = { ...current, query: action.query };
      break;
    case "expand":
      if (current.searchMode === "resting") return state;
      next = { ...current, searchMode: "expanded" };
      break;
    case "cancel":
      next = {
        ...current,
        query: "",
        searchMode: "resting",
        scrollOffset: current.searchEntryOffset,
      };
      break;
    case "scroll":
      if (current.scrollOffset === action.offset) return state;
      next = { ...current, scrollOffset: action.offset };
      break;
  }
  return { ...state, tabs: { ...state.tabs, [tab]: next } };
}

export const WORKSPACE_TOOLBAR = { height: 48, expandedGap: 10, edge: 16, gap: 8 };
/** `tabWidth` is one tab's share of the dock's tab group. */
export const WORKSPACE_DOCK = { height: 48, tabWidth: 88, gap: 12, bottomGap: 6 };

export function workspaceToolbarHeight(mode: WorkspaceSearchMode): number {
  return mode === "expanded"
    ? WORKSPACE_TOOLBAR.height * 2 + WORKSPACE_TOOLBAR.expandedGap
    : WORKSPACE_TOOLBAR.height;
}
