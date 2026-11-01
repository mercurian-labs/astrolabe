import { FoldVerticalIcon, LocateFixedIcon, ScanIcon, SlidersHorizontalIcon } from "lucide-react";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { activateTab, openBeside, openTab } from "~/panes/arrangement";
import { followedGraphFiles } from "~/panes/linkMarks";
import { PanesHostContext } from "~/panes/panesHost";
import { leafWithTab } from "~/panes/tree";
import { workspace } from "~/panes/workspace";
import {
  DEFAULT_CODE_GRAPH_OPTIONS,
  expansionFor,
  NO_EXPANSION,
  NO_KEYED_EXPANSION,
  parseCodeGraphOptions,
  rootsKey,
  type CodeGraphOptions,
  type KeyedExpansion,
} from "../codeGraph/codeGraphData";
import { CodeGraphView, GraphNotice, type CodeGraphViewHandle } from "../codeGraph/CodeGraphView";
import { storedChoice } from "../projects/storedChoice";
import { filePaneOf, followedPath, followLocalGraph, pinLocalGraph } from "./localGraph";
import { RepositoryTabHeader } from "./RepositoryTabHeader";
import { fileName, repositoryTabKey, type RepositoryGraphTab } from "./repositoryTabs";

/** The filter panel's choices, kept on the device for every local graph. */
const graphOptions = storedChoice<CodeGraphOptions>({
  storageKey: "astrolabe:repository-local-graph:v1",
  fallback: DEFAULT_CODE_GRAPH_OPTIONS,
  parse: parseCodeGraphOptions,
  serialize: JSON.stringify,
});

/**
 * Astrolabe: a file's local graph in Repositories (see `CodeGraphView`). It follows the file in
 * front of the focused pane of its checkout until pinned; a click opens a file in the pane beside
 * it, and a hover names the import that links a file in, lighting that line where the file is open.
 */
export default function RepositoryGraphView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: RepositoryGraphTab;
}) {
  const panes = useContext(PanesHostContext)?.controller ?? workspace.store;
  const arrangement = useSyncExternalStore(
    panes.subscribe,
    () => panes.getSnapshot()?.arrangement ?? null,
  );
  // A following graph keeps the file it showed while focus moves to a pane without one, and while
  // it is behind another tab, where it reads nothing new.
  const [followed, setFollowed] = useState<string | null>(null);
  const inFront = arrangement !== null && leafWithTab(arrangement.root, tabKey)?.active === tabKey;
  const path =
    tab.path ??
    (arrangement === null || !inFront ? followed : followedPath(arrangement, tab, followed));
  if (tab.path === null && path !== followed) setFollowed(path);
  // The link marker ties a following graph to the file it shows (`linkMarks`).
  const followedKey =
    tab.path === null && path !== null ? repositoryTabKey({ ...tab, kind: "file", path }) : null;
  // oxlint-disable-next-line t3code/react-effect-budget -- reports the followed file to the panes' link marks
  useEffect(() => {
    followedGraphFiles.set(tabKey, followedKey);
    return () => followedGraphFiles.set(tabKey, null);
  }, [followedKey, tabKey]);

  const options = graphOptions.useValue();
  const [expansionState, setExpansionState] = useState<KeyedExpansion>(NO_KEYED_EXPANSION);
  const key = path === null ? null : rootsKey([path]);
  const expansion = key === null ? NO_EXPANSION : expansionFor(expansionState, key);
  const viewRef = useRef<CodeGraphViewHandle>(null);

  const openFile = (target: string, newTab: boolean) => {
    const fileKey = repositoryTabKey({ ...tab, kind: "file", path: target });
    const now = panes.getSnapshot()?.arrangement;
    if (now === undefined) return;
    const paneId = filePaneOf(now, tabKey, tab, path);
    if (paneId === null) {
      // The graph stands alone: the file opens to its left.
      const graphPane = leafWithTab(now.root, tabKey)?.id;
      if (graphPane !== undefined) {
        panes.update((next) => openBeside(next, fileKey, graphPane, "left", { weight: 0.6 }));
      }
      return;
    }
    if (panes === workspace.store) {
      if (newTab) workspace.open(fileKey, "tab", paneId);
      else workspace.show(fileKey, paneId);
      return;
    }
    panes.update((next) =>
      leafWithTab(next.root, fileKey) ? activateTab(next, fileKey) : openTab(next, fileKey, paneId),
    );
  };

  const following = tab.path === null;
  const toggleFollowing = () => {
    if (!following) panes.update((next) => followLocalGraph(next, tabKey, tab));
    else if (path !== null) panes.update((next) => pinLocalGraph(next, tabKey, tab, path));
  };

  const panel = options.panel;
  const opened =
    expansion.neighbours.length + expansion.contents.length + expansion.collapsed.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RepositoryTabHeader.Root>
        <RepositoryTabHeader.Path>{path ?? ""}</RepositoryTabHeader.Path>
        {opened ? (
          <RepositoryTabHeader.Action
            label="Reset the graph"
            tooltip="Undo the neighbours and contents you opened"
            onClick={() => setExpansionState(NO_KEYED_EXPANSION)}
          >
            <FoldVerticalIcon />
          </RepositoryTabHeader.Action>
        ) : null}
        <RepositoryTabHeader.Action
          label="Following"
          tooltip={
            following
              ? "Following the file in front: click to keep this file"
              : "Follow the file in front"
          }
          pressed={following}
          disabled={following && path === null}
          onClick={toggleFollowing}
        >
          <LocateFixedIcon />
        </RepositoryTabHeader.Action>
        <RepositoryTabHeader.Action
          label="Fit the graph"
          disabled={path === null}
          onClick={() => viewRef.current?.fit()}
        >
          <ScanIcon />
        </RepositoryTabHeader.Action>
        <RepositoryTabHeader.Action
          label="Graph settings"
          tooltip={panel.open ? "Close graph settings" : "Graph settings"}
          pressed={panel.open}
          onClick={() => graphOptions.set({ ...options, panel: { ...panel, open: !panel.open } })}
        >
          <SlidersHorizontalIcon />
        </RepositoryTabHeader.Action>
      </RepositoryTabHeader.Root>
      {path === null || key === null ? (
        <GraphNotice>
          Open a file to see its local graph: the files it imports and the files that import it.
        </GraphNotice>
      ) : (
        <CodeGraphView
          ref={viewRef}
          environmentId={tab.environmentId}
          checkout={tab}
          roots={[path]}
          options={options}
          onOptionsChange={graphOptions.set}
          defaultOptions={DEFAULT_CODE_GRAPH_OPTIONS}
          expansion={expansion}
          onExpansionChange={(next) => setExpansionState({ key, expansion: next })}
          rootsLabel={fileName(path)}
          onOpen={(target, newTab) => openFile(target.path, newTab)}
          onReRoot={(root, reason) => {
            // A following graph follows the file a click opened into its pane.
            if (reason === "click" && following) return;
            panes.update((next) => pinLocalGraph(next, tabKey, tab, root));
          }}
        />
      )}
    </div>
  );
}
