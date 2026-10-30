import "@mercurian/graph/styles.css";
import { FileGraph, type FileGraphHandle, type FileGraphHover } from "@mercurian/graph/file";
import { CodeIndexError, type CodeGraphNode, type CodeLocalGraph } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ScanIcon } from "lucide-react";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useTheme } from "~/hooks/useTheme";
import {
  activateTab,
  allTabs,
  closeTab,
  openBeside,
  openTab,
  replaceTab,
  type Arrangement,
} from "~/panes/arrangement";
import { PanesHostContext } from "~/panes/panesHost";
import { leafWithTab } from "~/panes/tree";
import { codeLocalGraphEnvironment } from "~/state/codeLocalGraph";
import { useEnvironmentQuery } from "~/state/query";
import { ATLAS_COLORS } from "../graph/atlasColors";
import { storedChoice } from "../projects/storedChoice";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { importLineHighlight, importLineKey } from "./importLineHighlight";
import { filePaneOf, followedPath, localGraphKey } from "./localGraph";
import {
  DEFAULT_LOCAL_GRAPH_OPTIONS,
  expandFolder,
  expandedFor,
  importOf,
  localGraphInput,
  NO_EXPANSION,
  nodeAction,
  parseLocalGraphOptions,
  shownLocalGraph,
  type LocalGraphOptions,
} from "./localGraphData";
import { repositoryPanes } from "./repositoryPanes";
import { fileName, repositoryTabKey, type RepositoryGraphTab } from "./repositoryTabs";

/** The toolbar's choices, kept on the device for every local graph. */
const graphOptions = storedChoice<LocalGraphOptions>({
  storageKey: "astrolabe:repository-local-graph:v1",
  fallback: DEFAULT_LOCAL_GRAPH_OPTIONS,
  parse: parseLocalGraphOptions,
  serialize: JSON.stringify,
});

const isCodeIndexError = Schema.is(CodeIndexError);

/** While its repository's index builds, a graph reads again this often. */
const INDEXING_REFRESH_MS = 2_000;

type GraphHover = FileGraphHover & { readonly width: number; readonly height: number };

/**
 * Astrolabe: a file's local graph in Repositories (see `FileGraph`). It follows the file in front
 * of the focused pane of its checkout until pinned; a click opens a file in the pane beside it, and
 * a hover names the import that links a file in, lighting that line where the file is open.
 */
export default function RepositoryGraphView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: RepositoryGraphTab;
}) {
  const panes = useContext(PanesHostContext)?.controller ?? repositoryPanes.store;
  const arrangement = useSyncExternalStore(
    panes.subscribe,
    () => panes.getSnapshot()?.arrangement ?? null,
  );
  // A following graph keeps the file it showed while focus moves to a pane without one.
  const [followed, setFollowed] = useState<string | null>(null);
  const path =
    tab.path ?? (arrangement === null ? followed : followedPath(arrangement, tab, followed));
  if (tab.path === null && path !== followed) setFollowed(path);

  const options = graphOptions.useValue();
  const [expansion, setExpansion] = useState(NO_EXPANSION);
  const query = useEnvironmentQuery(
    path === null
      ? null
      : codeLocalGraphEnvironment.localGraph({
          environmentId: tab.environmentId,
          input: localGraphInput(tab, path, options, expandedFor(expansion, path)),
        }),
  );
  // The last graph stays up while the next is read, so moving between files never blanks it.
  const [last, setLast] = useState<CodeLocalGraph | null>(null);
  if (query.data !== null && query.data !== last) setLast(query.data);
  const failure = query.failure;
  const reason = isCodeIndexError(failure) ? failure.reason : null;
  const graph = path === null || failure !== null ? null : (query.data ?? last);
  const shown = graph === null ? null : shownLocalGraph(graph, options);

  const indexing = query.data?.usedByPending === true || reason === "not-indexed";
  const refresh = query.refresh;
  const answeredAt = query.dataUpdatedAt;
  // oxlint-disable-next-line t3code/react-effect-budget -- reads the graph again while the index builds
  useEffect(() => {
    if (!indexing) return;
    const timer = setTimeout(refresh, INDEXING_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [indexing, refresh, answeredAt]);
  // oxlint-disable-next-line t3code/react-effect-budget -- a closed graph lets go of the line it lit
  useEffect(() => () => importLineHighlight.set(null), []);

  const [hover, setHover] = useState<GraphHover | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<FileGraphHandle>(null);
  const { theme, resolvedTheme } = useTheme();

  const pathOf = (id: string) => graph?.nodes.find((node) => node.id === id)?.path ?? null;
  const onHover = (next: FileGraphHover | null) => {
    const frame = frameRef.current;
    setHover(
      next === null
        ? null
        : { ...next, width: frame?.clientWidth ?? 0, height: frame?.clientHeight ?? 0 },
    );
    const link = next === null || graph === null ? null : importOf(graph, next.id);
    const from = link === null ? null : pathOf(link.from);
    importLineHighlight.set(
      link === null || link.line === null || from === null
        ? null
        : {
            file: importLineKey({ environmentId: tab.environmentId, cwd: tab.cwd, path: from }),
            line: link.line,
          },
    );
  };

  const openFile = (target: string, newTab: boolean) => {
    const key = repositoryTabKey({ ...tab, kind: "file", path: target });
    const now = panes.getSnapshot()?.arrangement;
    if (now === undefined) return;
    const paneId = filePaneOf(now, tabKey, tab, path);
    if (paneId === null) {
      // The graph stands alone: the file opens to its left.
      const graphPane = leafWithTab(now.root, tabKey)?.id;
      if (graphPane !== undefined) {
        panes.update((arrangement) =>
          openBeside(arrangement, key, graphPane, "left", { weight: 0.6 }),
        );
      }
      return;
    }
    if (panes === repositoryPanes.store) {
      if (newTab) repositoryPanes.open(key, "tab", paneId);
      else repositoryPanes.show(key, paneId);
      return;
    }
    panes.update((arrangement) =>
      leafWithTab(arrangement.root, key)
        ? activateTab(arrangement, key)
        : openTab(arrangement, key, paneId),
    );
  };

  const onOpen = (id: string, modifier: boolean) => {
    const node = graph?.nodes.find((each) => each.id === id);
    const action = node === undefined ? null : nodeAction(node);
    if (action === null || graph === null) return;
    if (action.kind === "open") {
      openFile(action.path, modifier);
      return;
    }
    const center = pathOf(graph.center) ?? graph.center;
    setExpansion(expandFolder(expansion, center, action.folder));
  };

  const following = tab.path === null;
  const toggleFollowing = () => {
    if (following) {
      if (path !== null)
        panes.update((arrangement) => swapTab(arrangement, tabKey, localGraphKey(tab, path)));
      return;
    }
    const pinnedFile = repositoryTabKey({ ...tab, kind: "file", path: tab.path ?? "" });
    panes.update((arrangement) => {
      const swapped = swapTab(arrangement, tabKey, localGraphKey(tab));
      // Following picks up from the file it was pinned to, where that is open.
      return leafWithTab(swapped.root, pinnedFile) ? activateTab(swapped, pinnedFile) : swapped;
    });
  };

  const navigate = useNavigate();
  const showValues = (["uses", "usedBy", "tests", "dependencies"] as const).filter(
    (value) => options[value],
  );
  const progress = graph?.status ?? null;
  const percent =
    progress === null || progress.totalFiles === 0
      ? 0
      : Math.floor((progress.files / progress.totalFiles) * 100);

  let body: ReactNode;
  if (path === null) {
    body = (
      <GraphNotice>
        Open a file to see its local graph: the files it imports and the files that import it.
      </GraphNotice>
    );
  } else if (reason === "off") {
    body = (
      <GraphNotice>
        The code index is off for this repository.{" "}
        <Button
          className="h-auto p-0 align-baseline"
          variant="link"
          onClick={() => void navigate({ to: "/settings/projects" })}
        >
          Turn it on in Settings → Projects
        </Button>
      </GraphNotice>
    );
  } else if (reason === "unsupported") {
    body = (
      <GraphNotice>
        {fileName(path)} has no local graph: its language isn't indexed, or this project has no code
        index.
      </GraphNotice>
    );
  } else if (reason === "not-found") {
    body = <GraphNotice>{fileName(path)} isn't in this checkout.</GraphNotice>;
  } else if (reason === "not-indexed") {
    body = (
      <GraphNotice>
        The code index is still being built. The graph shows once it's ready.
      </GraphNotice>
    );
  } else if (failure !== null) {
    body = <GraphNotice>{query.error ?? "The graph couldn't be read."}</GraphNotice>;
  } else if (shown === null || graph === null) {
    body = <GraphNotice>Reading the graph…</GraphNotice>;
  } else {
    body = (
      <div ref={frameRef} className="relative min-h-0 flex-1" style={ATLAS_COLORS}>
        <FileGraph
          ref={graphRef}
          graph={shown.data}
          onOpen={onOpen}
          onHover={onHover}
          themeKey={`${theme}|${resolvedTheme}`}
        />
        {hover === null ? null : <HoverCard graph={graph} hover={hover} />}
        {graph.usedByPending && options.usedBy ? (
          <p className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/85 px-2 py-1 text-xs text-muted-foreground">
            Indexing {progress?.files ?? 0} of {progress?.totalFiles ?? 0} files: the files that use
            this one show once it finishes.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-1.5 py-1 text-xs text-muted-foreground">
        <ToggleGroup
          aria-label="Depth"
          value={[String(options.depth)]}
          onValueChange={(next) => {
            const depth = Number(next[0]);
            if (depth === 1 || depth === 2 || depth === 3) graphOptions.set({ ...options, depth });
          }}
        >
          {[1, 2, 3].map((depth) => (
            <Toggle key={depth} value={String(depth)} aria-label={`Depth ${depth}`}>
              {depth}
            </Toggle>
          ))}
        </ToggleGroup>
        <ToggleGroup
          multiple
          aria-label="Show"
          value={showValues}
          onValueChange={(next) =>
            graphOptions.set({
              ...options,
              uses: next.includes("uses"),
              usedBy: next.includes("usedBy"),
              tests: next.includes("tests"),
              dependencies: next.includes("dependencies"),
            })
          }
        >
          <Toggle value="uses">Uses</Toggle>
          <Toggle value="usedBy">
            {graph?.usedByPending ? `Used by · indexing ${percent}%` : "Used by"}
          </Toggle>
          <Toggle value="tests">Tests</Toggle>
          <Toggle value="dependencies">
            {shown === null ? "Dependencies" : `Dependencies · ${shown.dependencies}`}
          </Toggle>
        </ToggleGroup>
        <span className="min-w-0 flex-1 truncate font-mono">{path ?? ""}</span>
        <Button
          size="xs"
          variant="ghost"
          aria-pressed={following}
          data-pressed={following ? "" : undefined}
          disabled={following && path === null}
          onClick={toggleFollowing}
        >
          Following
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Fit the graph"
          disabled={shown === null}
          onClick={() => graphRef.current?.fit()}
        >
          <ScanIcon />
        </Button>
      </div>
      {body}
    </div>
  );
}

/** `key` in `next`'s place; where `next` is already open, that tab instead, and `key` closed. */
function swapTab(arrangement: Arrangement, key: string, next: string): Arrangement {
  return allTabs(arrangement).includes(next)
    ? activateTab(closeTab(arrangement, key), next)
    : replaceTab(arrangement, key, next);
}

function GraphNotice({ children }: { readonly children: ReactNode }) {
  return (
    <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** What a node is, in a few words: its size, how it changed, or what kind of thing it is. */
function nodeDetails(node: CodeGraphNode): string {
  const parts: string[] = [];
  if (node.kind === "package") parts.push("workspace package");
  if (node.kind === "dependency") parts.push("outside package");
  if (node.kind === "folder" && node.files !== null) {
    parts.push(`${node.files} files, folded: click to open`);
  }
  if (node.lines !== null) parts.push(node.lines === 1 ? "1 line" : `${node.lines} lines`);
  if (node.test) parts.push("test");
  if (node.changed === "uncommitted") parts.push("uncommitted changes");
  if (node.changed === "branch") parts.push("changed on this branch");
  return parts.join(" · ");
}

/** The hovered node's card, beside it on the side with room. */
function HoverCard({
  graph,
  hover,
}: {
  readonly graph: CodeLocalGraph;
  readonly hover: GraphHover;
}) {
  const node = graph.nodes.find((each) => each.id === hover.id);
  if (node === undefined) return null;
  const link = importOf(graph, node.id);
  const from = link === null ? null : graph.nodes.find((each) => each.id === link.from);
  const left = hover.x < hover.width / 2;
  const top = hover.y < hover.height / 2;
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-80 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
      style={{
        ...(left ? { left: hover.x + 14 } : { right: hover.width - hover.x + 14 }),
        ...(top ? { top: hover.y + 14 } : { bottom: hover.height - hover.y + 14 }),
      }}
    >
      <div className="truncate font-mono">{node.path ?? node.name}</div>
      <div className="text-muted-foreground">{nodeDetails(node)}</div>
      {link !== null && link.line !== null ? (
        <div className="mt-1.5">
          <div className="text-muted-foreground">
            {fileName(from?.path ?? link.from)}, line {link.line}
          </div>
          {link.text === null ? null : (
            <code className="block truncate font-mono text-foreground">{link.text}</code>
          )}
        </div>
      ) : null}
    </div>
  );
}
