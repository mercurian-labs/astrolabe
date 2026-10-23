import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  initialWorkspaceTabsState,
  workspaceTabsReducer,
  type WorkspaceTab,
  type WorkspaceTabsAction,
  type WorkspaceTabsState,
} from "./workspace-tabs-state";

export const WorkspaceTabsContext = createContext<{
  readonly state: WorkspaceTabsState;
  readonly dispatch: Dispatch<WorkspaceTabsAction>;
  readonly isTabActive: (tab: WorkspaceTab) => boolean;
  readonly bottomClearance: number;
  readonly getScrollOffset: (tab: WorkspaceTab) => number;
  readonly recordScrollOffset: (tab: WorkspaceTab, offset: number) => void;
  /** The wiki the Wikis list is filtered to, as `wikiScopeKey` names it; null for all. */
  readonly wikiScope: string | null;
  readonly setWikiScope: (scope: string | null) => void;
} | null>(null);

export function useWorkspaceTabs() {
  return use(WorkspaceTabsContext);
}

export function WorkspaceTabsProvider(props: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceTabsReducer, undefined, initialWorkspaceTabsState);
  const activeTab = useRef(state.selectedTab);
  useLayoutEffect(() => {
    activeTab.current = state.selectedTab;
  }, [state.selectedTab]);
  const isTabActive = useCallback((tab: WorkspaceTab) => activeTab.current === tab, []);
  // Astrolabe: the wiki filter, one value shared by Wikis and Change requests.
  const [wikiScope, setWikiScope] = useState<string | null>(null);
  const scrollOffsets = useRef<Record<WorkspaceTab, number>>({
    threads: 0,
    pullRequests: 0,
    wikis: 0,
    repositories: 0,
  });
  const getScrollOffset = useCallback((tab: WorkspaceTab) => scrollOffsets.current[tab], []);
  const recordScrollOffset = useCallback((tab: WorkspaceTab, offset: number) => {
    scrollOffsets.current[tab] = offset;
  }, []);
  const context = useMemo(
    () => ({
      state,
      dispatch,
      isTabActive,
      bottomClearance: 0,
      getScrollOffset,
      recordScrollOffset,
      wikiScope,
      setWikiScope,
    }),
    [state, isTabActive, getScrollOffset, recordScrollOffset, wikiScope],
  );
  return <WorkspaceTabsContext value={context}>{props.children}</WorkspaceTabsContext>;
}
