import "@mercurian/graph/styles.css";
import {
  FileGraph,
  type FileGraphContextMenu,
  type FileGraphHandle,
  type FileGraphHover,
} from "@mercurian/graph/file";
import {
  CodeIndexError,
  type CodeGraphNode,
  type CodeLocalGraph,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";

import { useTheme } from "~/hooks/useTheme";
import { readLocalApi } from "~/localApi";
import { codeIndexEnvironment } from "~/state/codeIndex";
import { codeLocalGraphEnvironment } from "~/state/codeLocalGraph";
import { useEnvironmentQuery } from "~/state/query";
import { importLineHighlight, importLineKey } from "../repositories/importLineHighlight";
import { Button } from "../ui/button";
import {
  ACTION_LABELS,
  clickAction,
  clusterMenu,
  codeGraphInput,
  focusOf,
  hideContents,
  importOf,
  nodeMenu,
  openTargetOf,
  showContents,
  shownCodeGraph,
  toggleNeighbours,
  type CodeGraphAction,
  type CodeGraphExpansion,
  type CodeGraphOptions,
  type OpenTarget,
} from "./codeGraphData";
import { CodeGraphPanel } from "./CodeGraphPanel";
import { ATLAS_COLORS } from "./graphColors";

const isCodeIndexError = Schema.is(CodeIndexError);

type GraphHover = FileGraphHover & { readonly width: number; readonly height: number };

/** A story's step as the view lights it: ids as the agent named them. */
export interface CodeGraphStep {
  readonly nodes: readonly string[];
  readonly links: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

export interface CodeGraphViewHandle {
  fit(): void;
}

export interface CodeGraphViewProps {
  readonly environmentId: EnvironmentId;
  readonly checkout: { readonly projectId: ProjectId; readonly cwd: string };
  readonly roots: readonly [string, ...string[]];
  readonly options: CodeGraphOptions;
  readonly onOptionsChange: (next: CodeGraphOptions) => void;
  readonly defaultOptions: CodeGraphOptions;
  /** What the reader added by hand, for these roots. */
  readonly expansion: CodeGraphExpansion;
  readonly onExpansionChange: (next: CodeGraphExpansion) => void;
  /** Open a node's file (a definition at its line), in a new tab with ⌘ held. */
  readonly onOpen: (target: OpenTarget, newTab: boolean) => void;
  /** Move the graph's root to a node: a click on the file it opened, or Centre here. */
  readonly onReRoot: (id: string, reason: "click" | "centre") => void;
  /** A story's step to light; its roots then draw plain. */
  readonly step?: CodeGraphStep | null;
  /** Said when the roots are not in the checkout, as "app.ts isn't in this checkout." does. */
  readonly rootsLabel: string;
  readonly ref?: Ref<CodeGraphViewHandle>;
}

/**
 * Astrolabe: a code graph drawn as Obsidian draws a vault (`FileGraph`), shared by the
 * Repositories local graph and a thread's Graph tab, which differ only in their roots. A click
 * opens a node's file and re-roots there; a double-click adds or removes its neighbours; the
 * right-click menu also shows or hides its contents and re-roots on it.
 */
export function CodeGraphView({
  environmentId,
  checkout,
  roots,
  options,
  onOptionsChange,
  defaultOptions,
  expansion,
  onExpansionChange,
  onOpen,
  onReRoot,
  step = null,
  rootsLabel,
  ref,
}: CodeGraphViewProps) {
  // The search narrows this view only, and is never kept.
  const [search, setSearch] = useState("");
  const query = useEnvironmentQuery(
    codeLocalGraphEnvironment.localGraph({
      environmentId,
      input: codeGraphInput(checkout, roots, options, expansion),
    }),
  );
  // The last graph stays up while the next is read, so moving between roots never blanks it.
  const [last, setLast] = useState<CodeLocalGraph | null>(null);
  if (query.data !== null && query.data !== last) setLast(query.data);
  const failure = query.failure;
  const reason = isCodeIndexError(failure) ? failure.reason : null;
  const graph = failure !== null ? null : (query.data ?? last);
  const shown = graph === null ? null : shownCodeGraph(graph, options, search, step !== null);
  const focus = shown === null || step === null ? null : focusOf(shown.data, step);

  const status = useAtomValue(codeIndexEnvironment.status(environmentId, checkout.projectId));
  // Progress moves the status, not the graph: a graph changes only when the index finishes or updates.
  const indexVersion = status === null ? null : `${status.state}|${status.updatedAt ?? ""}`;
  const refresh = query.refresh;
  const readAtVersion = useRef(indexVersion);
  // oxlint-disable-next-line t3code/react-effect-budget -- reads the graph again when the index finishes or updates
  useEffect(() => {
    const previous = readAtVersion.current;
    if (previous === indexVersion) return;
    readAtVersion.current = indexVersion;
    if (previous !== null) refresh();
  }, [indexVersion, refresh]);
  // oxlint-disable-next-line t3code/react-effect-budget -- a closed graph lets go of the line it lit
  useEffect(() => () => importLineHighlight.set(null), []);

  const [hover, setHover] = useState<GraphHover | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<FileGraphHandle>(null);
  useImperativeHandle(ref, () => ({ fit: () => graphRef.current?.fit() }), []);
  const { theme, resolvedTheme } = useTheme();

  const nodeOf = (id: string) => graph?.nodes.find((node) => node.id === id) ?? null;
  const onHover = (next: FileGraphHover | null) => {
    const frame = frameRef.current;
    setHover(
      next === null
        ? null
        : { ...next, width: frame?.clientWidth ?? 0, height: frame?.clientHeight ?? 0 },
    );
    const link = next === null || graph === null ? null : importOf(graph, next.id);
    const from = link === null ? null : (nodeOf(link.from)?.path ?? null);
    importLineHighlight.set(
      link === null || link.line === null || from === null
        ? null
        : {
            file: importLineKey({ environmentId, cwd: checkout.cwd, path: from }),
            line: link.line,
          },
    );
  };

  const act = (action: CodeGraphAction, id: string) => {
    const node = nodeOf(id);
    const cluster = graph?.clusters.find((each) => each.id === id) ?? null;
    switch (action) {
      case "expand-neighbours":
      case "collapse-neighbours":
        onExpansionChange(toggleNeighbours(expansion, id));
        return;
      case "show-contents":
        onExpansionChange(showContents(expansion, id));
        return;
      case "hide-contents":
        onExpansionChange(hideContents(expansion, id));
        return;
      case "centre":
        onReRoot(id, "centre");
        return;
      case "open": {
        const target =
          node !== null
            ? openTargetOf(node)
            : cluster?.path == null
              ? null
              : { path: cluster.path, line: null };
        if (target !== null) onOpen(target, false);
      }
    }
  };

  const onClick = (id: string, modifier: boolean) => {
    const node = nodeOf(id);
    const action = node === null ? null : clickAction(node);
    if (action === null) return;
    if (action.kind === "contents") {
      onExpansionChange(showContents(expansion, action.id));
      return;
    }
    onOpen(action.target, modifier);
    onReRoot(action.root, "click");
  };

  const onContextMenu = (menu: FileGraphContextMenu) => {
    const api = readLocalApi();
    const node = menu.target === "node" ? nodeOf(menu.id) : null;
    const cluster =
      menu.target === "cluster"
        ? (graph?.clusters.find((each) => each.id === menu.id) ?? null)
        : null;
    const actions =
      node !== null ? nodeMenu(node, expansion) : cluster !== null ? clusterMenu(cluster) : [];
    const bounds = frameRef.current?.getBoundingClientRect();
    if (api === undefined || actions.length === 0 || bounds === undefined) return;
    void api.contextMenu
      .show(
        actions.map((id) => ({ id, label: ACTION_LABELS[id] })),
        { x: bounds.left + menu.x, y: bounds.top + menu.y },
      )
      .then((picked) => {
        const action = actions.find((each) => each === picked);
        if (action !== undefined) act(action, menu.id);
      });
  };

  const navigate = useNavigate();
  const progress = status ?? graph?.status ?? null;
  const percent =
    progress === null || progress.totalFiles === 0
      ? 0
      : Math.floor((progress.files / progress.totalFiles) * 100);

  let body: ReactNode;
  if (reason === "off") {
    body = (
      <GraphNotice
        action={
          <Button
            size="xs"
            variant="link"
            onClick={() => void navigate({ to: "/settings/projects" })}
          >
            Turn it on in Settings → Projects
          </Button>
        }
      >
        The code index is off for this repository.
      </GraphNotice>
    );
  } else if (reason === "unsupported") {
    body = (
      <GraphNotice>
        {rootsLabel} has no local graph: its language isn't indexed, or this project has no code
        index.
      </GraphNotice>
    );
  } else if (reason === "not-found") {
    body = <GraphNotice>{rootsLabel} isn't in this checkout.</GraphNotice>;
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
      <div ref={frameRef} className="relative min-h-0 flex-1">
        <FileGraph
          ref={graphRef}
          graph={shown.data}
          settings={options.settings}
          focus={focus}
          onClick={onClick}
          onDoubleClick={(id) => {
            const node = nodeOf(id);
            if (node !== null && node.kind !== "dependency" && node.kind !== "package") {
              onExpansionChange(toggleNeighbours(expansion, id));
            }
          }}
          onClusterClick={(id) => onExpansionChange(hideContents(expansion, id))}
          onContextMenu={onContextMenu}
          onHover={onHover}
          themeKey={`${theme}|${resolvedTheme}`}
        />
        {hover === null ? null : <HoverCard graph={graph} hover={hover} expansion={expansion} />}
        {graph.usedByPending && options.usedBy ? (
          <p className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/85 px-2 py-1 text-xs text-muted-foreground">
            Indexing {progress?.files ?? 0} of {progress?.totalFiles ?? 0} files: the files that use
            these show once it finishes.
          </p>
        ) : null}
      </div>
    );
  }

  const panel = options.panel;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" style={ATLAS_COLORS}>
      {body}
      {panel.open ? (
        <CodeGraphPanel
          options={options}
          onChange={onOptionsChange}
          search={search}
          onSearch={setSearch}
          usedByLabel={graph?.usedByPending ? `Used by · indexing ${percent}%` : "Used by"}
          dependencies={shown === null ? null : shown.dependencies}
          onAnimate={() => graphRef.current?.animate()}
          onReset={() => {
            setSearch("");
            onOptionsChange({ ...defaultOptions, panel });
          }}
          onClose={() => onOptionsChange({ ...options, panel: { ...panel, open: false } })}
        />
      ) : null}
    </div>
  );
}

export function GraphNotice({
  children,
  action = null,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-6 text-center text-sm text-muted-foreground">
      <p role="status">{children}</p>
      {action}
    </div>
  );
}

const SYMBOL_KINDS: Readonly<Record<string, string>> = {
  class: "class",
  interface: "interface",
  enum: "enum",
  type: "type",
  function: "function",
  method: "method",
  constant: "constant",
  module: "module",
};

/** What a node is, in a few words: its size, how it changed, or what kind of thing it is. */
function nodeDetails(node: CodeGraphNode): string {
  const parts: string[] = [];
  if (node.kind === "package") parts.push("workspace package");
  if (node.kind === "dependency") parts.push("outside package");
  if (node.kind === "module") parts.push("module");
  if (node.symbol !== null)
    parts.push(`${SYMBOL_KINDS[node.symbol.kind] ?? "definition"}, line ${node.symbol.line}`);
  if (node.outsideProject === true) parts.push("outside this project");
  if ((node.kind === "folder" || node.kind === "module") && node.files !== null) {
    parts.push(node.files === 1 ? "1 file" : `${node.files} files`);
  }
  if (node.lines !== null && node.symbol === null) {
    parts.push(node.lines === 1 ? "1 line" : `${node.lines} lines`);
  }
  if (node.test) parts.push("test");
  if (node.changed === "uncommitted") parts.push("uncommitted changes");
  if (node.changed === "branch") parts.push("changed on this branch");
  return parts.join(" · ");
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The hovered node's card, beside it on the side with room. */
function HoverCard({
  graph,
  hover,
  expansion,
}: {
  readonly graph: CodeLocalGraph;
  readonly hover: GraphHover;
  readonly expansion: CodeGraphExpansion;
}) {
  const node = graph.nodes.find((each) => each.id === hover.id);
  if (node === undefined) return null;
  const link = importOf(graph, node.id);
  const from = link === null ? null : graph.nodes.find((each) => each.id === link.from);
  const left = hover.x < hover.width / 2;
  const top = hover.y < hover.height / 2;
  const grows = node.kind !== "dependency" && node.kind !== "package";
  const hint = grows
    ? expansion.neighbours.includes(node.id)
      ? "Double-click to collapse its neighbours"
      : "Double-click to expand its neighbours"
    : null;
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-80 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
      style={{
        ...(left ? { left: hover.x + 14 } : { right: hover.width - hover.x + 14 }),
        ...(top ? { top: hover.y + 14 } : { bottom: hover.height - hover.y + 14 }),
      }}
    >
      <div className="truncate font-mono">
        {node.kind === "symbol" ? node.id : (node.path ?? node.name)}
      </div>
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
      {hint === null ? null : <div className="mt-1.5 text-muted-foreground">{hint}</div>}
    </div>
  );
}
