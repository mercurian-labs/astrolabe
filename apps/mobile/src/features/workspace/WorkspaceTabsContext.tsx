import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, use, useState, type Dispatch, type ReactNode } from "react";

import { mobilePreferencesAtom } from "../../state/preferences";
import { hiddenNavigationTabs, registeredNavigationTabOrder } from "./navigation-tabs";
import { resolveSelectedNavigationTab } from "./navigation-tab-order";
import {
  initialWorkspaceTabsState,
  workspaceTabsReducer,
  type WorkspaceSearchTab,
  type WorkspaceTab,
  type WorkspaceTabsAction,
  type WorkspaceTabsState,
} from "./workspace-tabs-state";

export const WorkspaceTabsContext = createContext<{
  readonly state: WorkspaceTabsState;
  readonly dispatch: Dispatch<WorkspaceTabsAction>;
  readonly isTabActive: (tab: WorkspaceTab) => boolean;
  readonly bottomClearance: number;
  readonly settingsOpen: boolean;
  readonly getScrollOffset: (tab: WorkspaceSearchTab) => number;
  readonly recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => void;
  /** The wiki the Wikis list is filtered to, as `wikiScopeKey` names it; null for all. */
  readonly wikiScope: string | null;
  readonly setWikiScope: (scope: string | null) => void;
} | null>(null);

export function useWorkspaceTabs() {
  return use(WorkspaceTabsContext);
}

type MobilePreferencesResult = Atom.Type<typeof mobilePreferencesAtom>;

/** Moves the selection off a tab the user has hidden or that no longer exists. */
function resolveWorkspaceTabsSelection(
  state: WorkspaceTabsState,
  preferences: MobilePreferencesResult,
): WorkspaceTabsState {
  const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
  const order = registeredNavigationTabOrder(saved?.navigationTabOrder);
  const hidden = hiddenNavigationTabs(saved?.hiddenNavigationTabs);
  const selected = resolveSelectedNavigationTab(order, hidden, state.selectedTab);
  return selected && selected !== state.selectedTab
    ? workspaceTabsReducer(state, { type: "select", tab: selected })
    : state;
}

// One model per provider. Handlers on frozen screens keep stale closures, so
// they read the current selection from the registry at call time.
function createWorkspaceTabsModel() {
  const stored = Atom.make(initialWorkspaceTabsState());
  const scrollOffsets: Record<WorkspaceSearchTab, number> = {
    threads: 0,
    pullRequests: 0,
    wikis: 0,
    repositories: 0,
    usage: 0,
    settings: 0,
  };
  return {
    stored,
    resolved: Atom.make((get) =>
      resolveWorkspaceTabsSelection(get(stored), get(mobilePreferencesAtom)),
    ),
    getScrollOffset: (tab: WorkspaceSearchTab) => scrollOffsets[tab],
    recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => {
      scrollOffsets[tab] = offset;
    },
  };
}

export function WorkspaceTabsProvider(props: {
  readonly children: ReactNode;
  readonly settingsOpen?: boolean;
}) {
  const registry = use(RegistryContext);
  const [model] = useState(createWorkspaceTabsModel);
  const state = useAtomValue(model.resolved);
  // Astrolabe: the wiki filter, one value shared by Wikis and Change requests.
  const [wikiScope, setWikiScope] = useState<string | null>(null);
  const context = {
    state,
    dispatch: (action: WorkspaceTabsAction) =>
      registry.set(model.stored, workspaceTabsReducer(registry.get(model.resolved), action)),
    isTabActive: (tab: WorkspaceTab) => registry.get(model.resolved).selectedTab === tab,
    bottomClearance: 0,
    settingsOpen: props.settingsOpen ?? false,
    getScrollOffset: model.getScrollOffset,
    recordScrollOffset: model.recordScrollOffset,
    wikiScope,
    setWikiScope,
  };
  return <WorkspaceTabsContext value={context}>{props.children}</WorkspaceTabsContext>;
}
