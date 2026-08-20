import type {
  MercurianCommitId,
  PlanCodingSessionRecord,
  PlanImplementReady,
  PlanTimelineItem,
  ServerProvider,
} from "@t3tools/contracts";
import {
  ArrowDownIcon,
  CheckIcon,
  CircleDotIcon,
  Columns3Icon,
  FileTextIcon,
  GitCommitVerticalIcon,
  GitForkIcon,
  GitMergeIcon,
  LocateFixedIcon,
  Maximize2Icon,
  MessageSquareIcon,
  MessagesSquareIcon,
  Settings2Icon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  WaypointsIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from "../ui/slider";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  cameraTween,
  centerOn,
  DagExplorerDisplaySettings,
  DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS,
  detailFor,
  edgeWidthFor,
  fitTransform,
  mapOverflows,
  minimapPointToWorld,
  minimapProjection,
  minimapSize,
  proximityScale,
  radiusFor,
  visibleWorldRect,
  wheelIntent,
  zoomAtPoint,
  type DagExplorerDisplaySettings as DagExplorerDisplaySettingsValue,
  type MapFrameSize,
  type MapPoint,
  type MapTransform,
  type MapViewBox,
  type MinimapSize,
} from "./DagExplorer.logic";
import {
  COLUMN_PANE_WIDTH,
  COLUMN_STRIP_WIDTH,
  columnLayout,
  columnViewWidthCap,
  defaultBranchChoices,
  type Pane,
} from "./PlanColumns.logic";
import {
  condensePlanGraph,
  isUnansweredCheckpointInFlight,
  mapMarksToNodes,
  planCheckpointEffectLabel,
  planNodeIdForCommit,
  planNodeStatusDots,
  planNodeSummary,
} from "./PlanCheckpoints.logic";
import {
  ancestorClosure,
  dagLayout,
  descendantClosure,
  effectivePlanExplorerView,
  hasFork,
  planCommitSummary,
  type PlanGraph,
  type PlanGraphNode,
  type SpatialLayout,
  type SpatialNode,
  type SpatialPoint,
} from "./PlanGraph.logic";
import { PLAN_MAY_BE_STALE_DESCRIPTION, PLAN_MAY_BE_STALE_LABEL } from "./PlanFreshness";
import {
  PlanNodeDetailsButton,
  PlanNodePopover,
  usePlanNodePopover,
  type PlanNodePopoverController,
} from "./PlanNodePopover";
import { offeredActs, type PlanNodePopoverAct } from "./PlanNodePopover.logic";
import {
  branchOption,
  threadLayout,
  type BranchOption,
  type ThreadSwitch,
} from "./PlanThread.logic";

const DISPLAY_SETTINGS_STORAGE_KEY = "mercurian:dag-explorer-display:v1";
export const EXPLORER_VIEW_STORAGE_KEY = "mercurian:dag-explorer-view:v1";
export const ExplorerView = Schema.Literals(["thread", "columns", "graph"]);
export type ExplorerView = typeof ExplorerView.Type;
export const DEFAULT_EXPLORER_VIEW: ExplorerView = "thread";

/** One plain commit row; checkpoint rows expand to fit their turn content. */
const ROW_HEIGHT = 34;

const MAP_PADDING = 64;
const MAP_TWEEN_DURATION = 250;
/** How far the pointer has to travel before a press counts as a pan. */
const DRAG_THRESHOLD = 4;

type DisplaySettingsUpdater = (
  value:
    | DagExplorerDisplaySettingsValue
    | ((current: DagExplorerDisplaySettingsValue) => DagExplorerDisplaySettingsValue),
) => void;

/**
 * The Checkpoint Graph: the plan's whole checkpoint history, in the three readings the design
 * settled on.
 *
 * The **Thread** is the checked-out root-to-tip path through where the planning
 * surface stands. Rows make that line easy to read and move through, while
 * always-visible switches reveal its sibling branches and merge parents. The
 * **Columns** hold those same branch decisions open as standing segments, so
 * changing a line replaces only the panes beyond its fork. The
 * **Graph** is the spatial map: every continuable checkpoint or standalone act
 * a node, every parent edge drawn, the whole shape visible at once — for seeing
 * structure, not for walking it.
 *
 * Neither view renders a commit twice. A merge is one row in the thread and
 * one node in the map, with its alternate incoming lines available from the
 * row's switch.
 *
 * The explorer carries no subscription of its own. Every commit it draws comes
 * from the timeline the planning space already holds, which is why a commit
 * landing in another window shows up here, in the conversation, and in the
 * artifact at the same moment.
 */
export function DagExplorer({
  graph,
  anchoredCommitId,
  inFlightAnchorCommitId,
  providers,
  codingSessions,
  readyCommits,
  stalePlanCommitIds,
  staleSpecCommitIds,
  cornerControl,
  onColumnsWidthCapChange,
  onEditAndBranch,
  onImplementFrom,
  onSelect,
}: {
  readonly graph: PlanGraph;
  /** Where the surface is looking, or `null` when it is looking at now. */
  readonly anchoredCommitId: MercurianCommitId | null;
  /** The commit an assistant response currently streaming will continue from. */
  readonly inFlightAnchorCommitId?: MercurianCommitId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly readyCommits: ReadonlyMap<MercurianCommitId, PlanImplementReady>;
  readonly stalePlanCommitIds: ReadonlySet<string>;
  readonly staleSpecCommitIds: ReadonlySet<string>;
  /** The planning-space pane toggle; omitted in standalone renderings. */
  readonly cornerControl?: ReactNode;
  readonly onColumnsWidthCapChange: (width: number) => void;
  readonly onEditAndBranch: (
    query: Extract<PlanTimelineItem, { readonly _tag: "message" }>,
  ) => void;
  readonly onImplementFrom: (commitId: MercurianCommitId) => void;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const [storedView, setView] = useLocalStorage(
    EXPLORER_VIEW_STORAGE_KEY,
    DEFAULT_EXPLORER_VIEW,
    ExplorerView,
  );
  const checkpointGraph = useMemo(() => condensePlanGraph(graph), [graph]);
  const columnsAvailable = hasFork(checkpointGraph);
  const view = effectivePlanExplorerView(checkpointGraph, storedView);
  // Standing at the tip is standing at the latest commit; an anchor is what
  // moves the highlight anywhere else.
  const currentCommitId = planNodeIdForCommit(
    anchoredCommitId ?? graph.latest,
    checkpointGraph.nodeIdByCommit,
  );
  const readyNodes = useMemo(
    () =>
      new Map<MercurianCommitId, PlanImplementReady>(
        [...readyCommits].map(
          ([commitId, ready]) =>
            [checkpointGraph.nodeIdByCommit.get(commitId) ?? commitId, ready] as const,
        ),
      ),
    [checkpointGraph.nodeIdByCommit, readyCommits],
  );
  const stalePlanNodes = useMemo(
    () => mapMarksToNodes(stalePlanCommitIds, checkpointGraph.nodeIdByCommit),
    [checkpointGraph.nodeIdByCommit, stalePlanCommitIds],
  );
  const staleSpecNodes = useMemo(
    () => mapMarksToNodes(staleSpecCommitIds, checkpointGraph.nodeIdByCommit),
    [checkpointGraph.nodeIdByCommit, staleSpecCommitIds],
  );
  const inFlightUnansweredNodes = useMemo(
    () =>
      new Set(
        checkpointGraph.nodes
          .filter((node) => isUnansweredCheckpointInFlight(node, graph, inFlightAnchorCommitId))
          .map((node) => node.commitId),
      ),
    [checkpointGraph.nodes, graph, inFlightAnchorCommitId],
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="workspace-topbar gap-2 border-b border-border px-3 sm:px-4">
        <h2 className="text-sm font-medium text-foreground">Checkpoint Graph</h2>
        {staleSpecNodes.size === 0 && stalePlanNodes.size === 0 ? null : (
          <GraphWarningsPopover
            stalePlanCount={stalePlanNodes.size}
            staleSpecCount={staleSpecNodes.size}
          />
        )}
        <span className="min-w-0 flex-1" />
        <ToggleGroup
          className="shrink-0"
          size="xs"
          value={[view]}
          variant="outline"
          onValueChange={(next) => {
            const chosen = next[0];
            // The switch is a choice between three views, never a way to have
            // neither: re-pressing the active one leaves it pressed.
            if (chosen === "thread" || chosen === "columns" || chosen === "graph") {
              setView(chosen);
            }
          }}
        >
          <Tooltip>
            <TooltipTrigger render={<Toggle aria-label="Thread" value="thread" />}>
              <GitCommitVerticalIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Thread</TooltipPopup>
          </Tooltip>
          {columnsAvailable ? (
            <Tooltip>
              <TooltipTrigger render={<Toggle aria-label="Columns" value="columns" />}>
                <Columns3Icon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">Columns</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger render={<Toggle aria-label="Graph" value="graph" />}>
              <WaypointsIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Graph</TooltipPopup>
          </Tooltip>
        </ToggleGroup>
        {cornerControl}
      </div>
      {checkpointGraph.nodes.length === 0 ? (
        <div className="min-h-0 flex-1 px-3 py-6 sm:px-4">
          <p className="text-sm text-muted-foreground/70">Nothing has happened here yet.</p>
        </div>
      ) : view === "thread" ? (
        <ThreadView
          codingSessions={codingSessions}
          commitGraph={graph}
          currentCommitId={currentCommitId}
          graph={checkpointGraph}
          inFlightUnansweredNodes={inFlightUnansweredNodes}
          providers={providers}
          readyCommits={readyNodes}
          stalePlanCommitIds={stalePlanNodes}
          staleSpecCommitIds={staleSpecNodes}
          onEditAndBranch={onEditAndBranch}
          onImplementFrom={onImplementFrom}
          onSelect={onSelect}
        />
      ) : view === "columns" ? (
        <ColumnsView
          codingSessions={codingSessions}
          commitGraph={graph}
          currentCommitId={currentCommitId}
          graph={checkpointGraph}
          inFlightUnansweredNodes={inFlightUnansweredNodes}
          readyCommits={readyNodes}
          stalePlanCommitIds={stalePlanNodes}
          staleSpecCommitIds={staleSpecNodes}
          providers={providers}
          onEditAndBranch={onEditAndBranch}
          onImplementFrom={onImplementFrom}
          onSelect={onSelect}
          onWidthCapChange={onColumnsWidthCapChange}
        />
      ) : (
        <GraphView
          codingSessions={codingSessions}
          commitGraph={graph}
          currentCommitId={currentCommitId}
          graph={checkpointGraph}
          inFlightUnansweredNodes={inFlightUnansweredNodes}
          readyCommits={readyNodes}
          stalePlanCommitIds={stalePlanNodes}
          staleSpecCommitIds={staleSpecNodes}
          providers={providers}
          onEditAndBranch={onEditAndBranch}
          onImplementFrom={onImplementFrom}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}

function ActivePlanNodePopover({
  controller,
  graph,
  commitGraph,
  codingSessions,
  providers,
  readyCommits,
  stalePlanCommitIds,
  staleSpecCommitIds,
  inFlightUnansweredNodes,
  onSelect,
  onEditAndBranch,
  onImplementFrom,
}: {
  readonly controller: PlanNodePopoverController;
  readonly graph: PlanGraph;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly readyCommits: ReadonlyMap<MercurianCommitId, PlanImplementReady>;
  readonly stalePlanCommitIds: ReadonlySet<string>;
  readonly staleSpecCommitIds: ReadonlySet<string>;
  readonly inFlightUnansweredNodes: ReadonlySet<string>;
  readonly onSelect: (commitId: MercurianCommitId) => void;
  readonly onEditAndBranch: (
    query: Extract<PlanTimelineItem, { readonly _tag: "message" }>,
  ) => void;
  readonly onImplementFrom: (commitId: MercurianCommitId) => void;
}) {
  const node = controller.state === null ? undefined : graph.byId.get(controller.state.commitId);
  return (
    <PlanNodePopover
      codingSessions={codingSessions}
      commitGraph={commitGraph}
      controller={controller}
      node={node}
      providers={providers}
      {...(node === undefined || readyCommits.get(node.commitId) === undefined
        ? {}
        : { ready: readyCommits.get(node.commitId)! })}
      stalePlan={node !== undefined && stalePlanCommitIds.has(node.commitId)}
      staleSpec={node !== undefined && staleSpecCommitIds.has(node.commitId)}
      suppressUnanswered={node !== undefined && inFlightUnansweredNodes.has(node.commitId)}
      onEditAndBranch={onEditAndBranch}
      onImplementFrom={onImplementFrom}
      onSelect={onSelect}
    />
  );
}

/** The Graph node's direct act, with its popover retained as the safe fallback. */
export function graphNodePopoverInteraction({
  acts,
  commitId,
  popover,
  onSelect,
}: {
  readonly acts: ReadonlyArray<PlanNodePopoverAct>;
  readonly commitId: MercurianCommitId;
  readonly popover: PlanNodePopoverController;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  return {
    activate(anchor: Element) {
      if (!acts.includes("continue")) {
        popover.open(commitId, anchor);
        return;
      }
      popover.close();
      onSelect(commitId);
    },
    linger(anchor: Element) {
      popover.linger(commitId, anchor);
    },
    scheduleClose: popover.scheduleClose,
  };
}

function DisplaySettingsPopover({
  settings,
  onSettingsChange,
}: {
  readonly settings: DagExplorerDisplaySettingsValue;
  readonly onSettingsChange: DisplaySettingsUpdater;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label="Graph display settings"
            size="icon-xs"
            type="button"
            variant="ghost"
          />
        }
      >
        <Settings2Icon />
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-64">
        <DagExplorerDisplaySettingsControls
          settings={settings}
          onSettingsChange={onSettingsChange}
        />
      </PopoverPopup>
    </Popover>
  );
}

function GraphWarningsPopover({
  stalePlanCount,
  staleSpecCount,
}: {
  readonly stalePlanCount: number;
  readonly staleSpecCount: number;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label="Checkpoint Graph warnings"
            className="text-amber-600 hover:text-amber-700 dark:text-amber-400"
            size="icon-xs"
            type="button"
            variant="ghost"
          />
        }
      >
        <TriangleAlertIcon />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-72">
        <DagExplorerWarningsContent
          stalePlanCount={stalePlanCount}
          staleSpecCount={staleSpecCount}
        />
      </PopoverPopup>
    </Popover>
  );
}

/** The compact warning reading opened from the graph header. */
export function DagExplorerWarningsContent({
  stalePlanCount,
  staleSpecCount,
}: {
  readonly stalePlanCount: number;
  readonly staleSpecCount: number;
}) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      {staleSpecCount === 0 ? null : (
        <p>
          <span className="font-medium text-foreground">
            {staleSpecCount} stale spec {staleSpecCount === 1 ? "branch" : "branches"}
          </span>
          <span className="text-muted-foreground">{" — spec changed since the branch's base"}</span>
        </p>
      )}
      {stalePlanCount === 0 ? null : (
        <p>
          <span className="font-medium text-foreground">
            {stalePlanCount === 1 ? "1 plan may be stale" : `${stalePlanCount} plans may be stale`}
          </span>
          <span className="text-muted-foreground"> — {PLAN_MAY_BE_STALE_DESCRIPTION}</span>
        </p>
      )}
    </div>
  );
}

/** The graph's complete display vocabulary; detail level is intentionally absent. */
export function DagExplorerDisplaySettingsControls({
  settings,
  onSettingsChange,
}: {
  readonly settings: DagExplorerDisplaySettingsValue;
  readonly onSettingsChange: DisplaySettingsUpdater;
}) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
        Display layout
        <Select
          value={settings.layout}
          onValueChange={(layout) => {
            if (layout === "sugiyama" || layout === "grid" || layout === "zherebko") {
              onSettingsChange((current) => ({ ...current, layout }));
            }
          }}
        >
          <SelectTrigger aria-label="Display layout" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="sugiyama">Sugiyama</SelectItem>
            <SelectItem value="grid">Grid</SelectItem>
            <SelectItem value="zherebko">Zherebko</SelectItem>
          </SelectPopup>
        </Select>
      </label>
      <DisplaySlider
        label="Node size"
        value={settings.nodeSize}
        onValueChange={(nodeSize) => onSettingsChange((current) => ({ ...current, nodeSize }))}
      />
      <DisplaySlider
        label="Line thickness"
        value={settings.lineThickness}
        onValueChange={(lineThickness) =>
          onSettingsChange((current) => ({ ...current, lineThickness }))
        }
      />
    </div>
  );
}

function DisplaySlider({
  label,
  value,
  onValueChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly onValueChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
        <span>{label}</span>
        <output className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {value.toFixed(2)}
        </output>
      </div>
      <Slider max={5} min={0} step={0.05} value={value} onValueChange={onValueChange}>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
          </SliderTrack>
          <SliderThumb getAriaLabel={() => label} />
        </SliderControl>
      </Slider>
    </div>
  );
}

/**
 * The checked-out thread: one plain root-to-tip list, with switches only where
 * that line diverges from siblings or converges at a merge.
 */
function ThreadView({
  graph,
  commitGraph,
  codingSessions,
  providers,
  currentCommitId,
  inFlightUnansweredNodes,
  readyCommits,
  stalePlanCommitIds,
  staleSpecCommitIds,
  onEditAndBranch,
  onImplementFrom,
  onSelect,
}: {
  readonly graph: PlanGraph;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly currentCommitId: MercurianCommitId | null;
  readonly inFlightUnansweredNodes: ReadonlySet<string>;
  readonly readyCommits: ReadonlyMap<MercurianCommitId, PlanImplementReady>;
  readonly stalePlanCommitIds: ReadonlySet<string>;
  readonly staleSpecCommitIds: ReadonlySet<string>;
  readonly onEditAndBranch: (
    query: Extract<PlanTimelineItem, { readonly _tag: "message" }>,
  ) => void;
  readonly onImplementFrom: (commitId: MercurianCommitId) => void;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const [parentChoices, setParentChoices] = useState<ReadonlyMap<string, MercurianCommitId>>(
    () => new Map(),
  );
  const layout = useMemo(
    () => threadLayout(graph, currentCommitId, parentChoices),
    [currentCommitId, graph, parentChoices],
  );
  const scrollRef = useCurrentRowScroll(currentCommitId);
  const popover = usePlanNodePopover();

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto py-2">
        <ol className="flex flex-col">
          {layout.rows.map((row) => (
            <li key={row.commitId}>
              <PlanNodeRow
                isCurrent={row.commitId === currentCommitId}
                node={row}
                popover={popover}
                ready={readyCommits.has(row.commitId)}
                stalePlan={stalePlanCommitIds.has(row.commitId)}
                staleSpec={staleSpecCommitIds.has(row.commitId)}
                suppressUnanswered={inFlightUnansweredNodes.has(row.commitId)}
                ref={row.commitId === currentCommitId ? scrollRef : undefined}
                trailing={
                  row.siblings !== undefined || row.parentLines !== undefined ? (
                    <span
                      className="flex shrink-0 items-center gap-1"
                      onPointerEnter={(event) => {
                        event.stopPropagation();
                        popover.close();
                      }}
                    >
                      {row.siblings !== undefined ? (
                        <DivergenceBadge
                          graph={graph}
                          kind="siblings"
                          selection={row.siblings}
                          onChoose={(option) => onSelect(option.tipId)}
                        />
                      ) : null}
                      {row.parentLines !== undefined ? (
                        <DivergenceBadge
                          graph={graph}
                          kind="parent-lines"
                          selection={row.parentLines}
                          onChoose={(option) => {
                            setParentChoices((current) => {
                              if (current.get(row.commitId) === option.branchRootId) return current;
                              const next = new Map(current);
                              next.set(row.commitId, option.branchRootId);
                              return next;
                            });
                          }}
                        />
                      ) : null}
                    </span>
                  ) : null
                }
                onSelect={onSelect}
              />
            </li>
          ))}
        </ol>
      </div>
      <ActivePlanNodePopover
        codingSessions={codingSessions}
        commitGraph={commitGraph}
        controller={popover}
        graph={graph}
        inFlightUnansweredNodes={inFlightUnansweredNodes}
        providers={providers}
        readyCommits={readyCommits}
        stalePlanCommitIds={stalePlanCommitIds}
        staleSpecCommitIds={staleSpecCommitIds}
        onEditAndBranch={onEditAndBranch}
        onImplementFrom={onImplementFrom}
        onSelect={onSelect}
      />
    </>
  );
}

function DivergenceBadge({
  graph,
  kind,
  selection,
  onChoose,
}: {
  readonly graph: PlanGraph;
  readonly kind: "siblings" | "parent-lines";
  readonly selection: ThreadSwitch;
  readonly onChoose: (option: BranchOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () => selection.options.map((optionId) => branchOption(graph, optionId)),
    [graph, selection.options],
  );
  const isSiblingSwitch = kind === "siblings";
  const Icon = isSiblingSwitch ? GitForkIcon : GitMergeIcon;
  const position = `${selection.index + 1}/${selection.options.length}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        closeDelay={0}
        delay={150}
        openOnHover
        render={
          <button
            aria-label={`${isSiblingSwitch ? "Switch branch" : "Choose parent line"}, ${position}`}
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] tabular-nums text-muted-foreground outline-hidden",
              "hover:bg-accent data-[pressed]:bg-accent",
              "focus-visible:ring-2 focus-visible:ring-ring",
            )}
            type="button"
          />
        }
      >
        <Icon aria-hidden className="size-3" />
        <span>{position}</span>
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-72 max-w-none" side="right" viewportClassName="p-1">
        <div className="flex flex-col gap-0.5">
          {options.map((option, index) => {
            const isCurrent = index === selection.index;
            return (
              <button
                aria-current={isCurrent ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-hidden",
                  "hover:bg-accent focus-visible:bg-accent disabled:cursor-default disabled:bg-accent/50",
                )}
                disabled={isCurrent}
                key={option.branchRootId}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onChoose(option);
                }}
              >
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs",
                    option.published ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {option.summary}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground/70">
                  {formatRelativeTimeLabel(option.lastActiveAt)}
                </span>
                {isCurrent ? (
                  <CheckIcon aria-label="Current line" className="size-3.5 shrink-0" />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

interface ColumnFocusEntry {
  readonly key: string;
  readonly paneIndex: number;
  readonly rowIndex: number;
}

/**
 * The checked-out line as standing branch segments. A fork keeps its choices
 * under the run that produced them; choosing one replaces only what follows.
 *
 * Panes reopen from right to left as the container grows. Focus and a manual
 * strip click may hold one extra pane open beyond what fits, preserving the
 * semantic keyboard path without making width allocation navigation state.
 */
function ColumnsView({
  graph,
  commitGraph,
  codingSessions,
  providers,
  currentCommitId,
  inFlightUnansweredNodes,
  readyCommits,
  stalePlanCommitIds,
  staleSpecCommitIds,
  onEditAndBranch,
  onImplementFrom,
  onSelect,
  onWidthCapChange,
}: {
  readonly graph: PlanGraph;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly currentCommitId: MercurianCommitId | null;
  readonly inFlightUnansweredNodes: ReadonlySet<string>;
  readonly readyCommits: ReadonlyMap<MercurianCommitId, PlanImplementReady>;
  readonly stalePlanCommitIds: ReadonlySet<string>;
  readonly staleSpecCommitIds: ReadonlySet<string>;
  readonly onEditAndBranch: (
    query: Extract<PlanTimelineItem, { readonly _tag: "message" }>,
  ) => void;
  readonly onImplementFrom: (commitId: MercurianCommitId) => void;
  readonly onSelect: (commitId: MercurianCommitId) => void;
  readonly onWidthCapChange: (width: number) => void;
}) {
  const [branchChoices, setBranchChoices] = useState<ReadonlyMap<string, MercurianCommitId>>(() =>
    defaultBranchChoices(graph, currentCommitId),
  );
  const layout = useMemo(
    () => columnLayout(graph, currentCommitId, branchChoices),
    [branchChoices, currentCommitId, graph],
  );
  const currentPaneIndex = layout.panes.findIndex((pane) =>
    pane.rows.some((row) => row.commitId === currentCommitId),
  );
  const activePaneIndex = Math.max(
    0,
    currentPaneIndex >= 0 ? currentPaneIndex : layout.panes.length - 1,
  );
  const entriesByPane = useMemo(
    () => layout.panes.map((pane, paneIndex) => columnFocusEntries(pane, paneIndex)),
    [layout.panes],
  );
  const currentKey = currentCommitId === null ? undefined : commitFocusKey(currentCommitId);
  const openingFocusKey =
    (currentKey !== undefined && entriesByPane.flat().some((entry) => entry.key === currentKey)
      ? currentKey
      : entriesByPane.at(-1)?.at(-1)?.key) ?? "";
  const [expandedPaneIndex, setExpandedPaneIndex] = useState(activePaneIndex);
  const [focusedKey, setFocusedKey] = useState(openingFocusKey);
  const interactiveRefs = useRef(new Map<string, HTMLButtonElement>());
  const paneScrollOffsetsRef = useRef(new Map<string, number>());
  const pendingFocusRef = useRef<{ readonly scroll: boolean } | null>(null);
  const currentScrollRef = useCurrentRowScroll(currentCommitId);
  const columnsContainerRef = useRef<HTMLDivElement>(null);
  const [columnsContainerWidth, setColumnsContainerWidth] = useState(0);
  const popover = usePlanNodePopover();

  const widthCap = columnViewWidthCap(layout.panes);
  useLayoutEffect(() => {
    onWidthCapChange(widthCap);
  }, [onWidthCapChange, widthCap]);

  useLayoutEffect(() => {
    const element = columnsContainerRef.current;
    if (element === null) return;

    const updateWidth = (nextWidth: number) => {
      setColumnsContainerWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    updateWidth(element.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) updateWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const firstAutoExpandedPaneIndex = autoExpandedPaneStart(
    layout.panes.length,
    columnsContainerWidth,
  );
  const manuallyExpandedBeyondAuto =
    expandedPaneIndex >= 0 && expandedPaneIndex < firstAutoExpandedPaneIndex;
  const expandedPaneCount =
    layout.panes.length - firstAutoExpandedPaneIndex + (manuallyExpandedBeyondAuto ? 1 : 0);

  useEffect(() => {
    setExpandedPaneIndex(activePaneIndex);
  }, [activePaneIndex, currentCommitId]);

  useEffect(() => {
    const entries = entriesByPane.flat();
    if (entries.some((entry) => entry.key === focusedKey)) return;
    setFocusedKey(openingFocusKey);
  }, [entriesByPane, focusedKey, openingFocusKey]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) return;
    if (focusedKey === "") return;
    const element = interactiveRefs.current.get(focusedKey);
    if (element === undefined) return;
    if (document.activeElement !== element) element.focus();
    if (pending.scroll) {
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    pendingFocusRef.current = null;
  }, [expandedPaneIndex, focusedKey, layout]);

  const moveFocus = useCallback((entry: ColumnFocusEntry, scroll = false) => {
    pendingFocusRef.current = { scroll };
    setExpandedPaneIndex(entry.paneIndex);
    setFocusedKey(entry.key);
  }, []);

  const onRovingKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, entry: ColumnFocusEntry) => {
      const verticalDelta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (verticalDelta !== 0) {
        const target = entriesByPane[entry.paneIndex]?.[entry.rowIndex + verticalDelta];
        if (target === undefined) return;
        event.preventDefault();
        moveFocus(target, true);
        return;
      }

      const horizontalDelta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (horizontalDelta === 0) return;
      const targetPane = entriesByPane[entry.paneIndex + horizontalDelta];
      if (targetPane === undefined || targetPane.length === 0) return;
      event.preventDefault();
      moveFocus(targetPane[Math.min(entry.rowIndex, targetPane.length - 1)]!, true);
    },
    [entriesByPane, moveFocus],
  );

  const registerRow = useCallback(
    (key: string, isCurrent: boolean) => (element: HTMLButtonElement | null) => {
      if (element === null) {
        interactiveRefs.current.delete(key);
      } else {
        interactiveRefs.current.set(key, element);
      }
      if (isCurrent) currentScrollRef.current = element;
    },
    [currentScrollRef],
  );

  const jumpToMerge = useCallback(
    (mergeCommitId: MercurianCommitId) => {
      const key = commitFocusKey(mergeCommitId);
      const entry = entriesByPane.flat().find((candidate) => candidate.key === key);
      if (entry !== undefined) moveFocus(entry, true);
    },
    [entriesByPane, moveFocus],
  );

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto" ref={columnsContainerRef}>
        {layout.panes.map((pane, paneIndex) => {
          const compressed =
            paneIndex < firstAutoExpandedPaneIndex && paneIndex !== expandedPaneIndex;
          const entries = entriesByPane[paneIndex] ?? [];
          const paneKey = pane.rows[0]?.commitId ?? `pane-${paneIndex}`;
          if (compressed) {
            return (
              <button
                aria-label={paneSpanLabel(pane)}
                className={cn(
                  "flex min-h-0 w-8 shrink-0 flex-col items-center gap-2 overflow-hidden py-3 outline-hidden",
                  paneIndex === 0 && "ml-auto",
                  paneIndex > 0 && "border-l border-border",
                  "hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                )}
                key={paneKey}
                tabIndex={-1}
                type="button"
                onClick={() => {
                  const target = entries[0];
                  if (target !== undefined) moveFocus(target, true);
                }}
              >
                {pane.rows.map((row) => (
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full border border-muted-foreground/70",
                      row.item.published && "bg-muted-foreground",
                    )}
                    key={row.commitId}
                  />
                ))}
              </button>
            );
          }

          return (
            <div
              className={cn(
                "min-h-0 overflow-y-auto py-2",
                "w-56 min-w-56 grow shrink-0",
                expandedPaneCount === 1 ? "max-w-104" : "max-w-84",
                paneIndex === 0 && "ml-auto",
                paneIndex > 0 && "border-l border-border",
              )}
              key={paneKey}
              ref={(element) => {
                if (element !== null)
                  element.scrollTop = paneScrollOffsetsRef.current.get(paneKey) ?? 0;
              }}
              onScroll={(event) => {
                paneScrollOffsetsRef.current.set(paneKey, event.currentTarget.scrollTop);
              }}
            >
              <ol className="flex flex-col px-1">
                {pane.rows.map((row, rowIndex) => {
                  const key = commitFocusKey(row.commitId);
                  const entry = entries[rowIndex]!;
                  const isCurrent = row.commitId === currentCommitId;
                  return (
                    <li key={row.commitId}>
                      <PlanNodeRow
                        isCurrent={isCurrent}
                        node={row}
                        popover={popover}
                        ready={readyCommits.has(row.commitId)}
                        stalePlan={stalePlanCommitIds.has(row.commitId)}
                        staleSpec={staleSpecCommitIds.has(row.commitId)}
                        suppressUnanswered={inFlightUnansweredNodes.has(row.commitId)}
                        ref={registerRow(key, isCurrent)}
                        tabIndex={focusedKey === key ? 0 : -1}
                        trailing={null}
                        onFocus={() => setFocusedKey(key)}
                        onKeyDown={(event) => onRovingKeyDown(event, entry)}
                        onSelect={onSelect}
                      />
                    </li>
                  );
                })}
              </ol>
              <ColumnTerminal
                entries={entries}
                focusedKey={focusedKey}
                pane={pane}
                paneIndex={paneIndex}
                registerRow={registerRow}
                onChoose={(forkId, childId) => {
                  setBranchChoices((current) => {
                    if (current.get(forkId) === childId) return current;
                    const next = new Map(current);
                    next.set(forkId, childId);
                    return next;
                  });
                }}
                onJumpToMerge={jumpToMerge}
                onRovingKeyDown={onRovingKeyDown}
                onFocusKey={setFocusedKey}
              />
            </div>
          );
        })}
      </div>
      <ActivePlanNodePopover
        codingSessions={codingSessions}
        commitGraph={commitGraph}
        controller={popover}
        graph={graph}
        inFlightUnansweredNodes={inFlightUnansweredNodes}
        providers={providers}
        readyCommits={readyCommits}
        stalePlanCommitIds={stalePlanCommitIds}
        staleSpecCommitIds={staleSpecCommitIds}
        onEditAndBranch={onEditAndBranch}
        onImplementFrom={onImplementFrom}
        onSelect={onSelect}
      />
    </>
  );
}

/** The first pane that fits at reading width when reopening from the right. */
function autoExpandedPaneStart(paneCount: number, containerWidth: number): number {
  if (paneCount <= 1) return 0;

  // With k panes open, base(k) = k*224 + (n-k)*32; the next pane opens
  // at base+192. Flex capacity is 112*k, or 192 for k=1, so every band
  // reaches the next threshold without leaving room for an empty margin.
  let occupiedWidth = COLUMN_PANE_WIDTH + (paneCount - 1) * COLUMN_STRIP_WIDTH;
  let firstExpandedPaneIndex = paneCount - 1;
  const paneExpansionWidth = COLUMN_PANE_WIDTH - COLUMN_STRIP_WIDTH;

  for (let paneIndex = paneCount - 2; paneIndex >= 0; paneIndex -= 1) {
    if (occupiedWidth + paneExpansionWidth > containerWidth) break;
    occupiedWidth += paneExpansionWidth;
    firstExpandedPaneIndex = paneIndex;
  }

  return firstExpandedPaneIndex;
}

function ColumnTerminal({
  entries,
  focusedKey,
  pane,
  paneIndex,
  registerRow,
  onChoose,
  onJumpToMerge,
  onRovingKeyDown,
  onFocusKey,
}: {
  readonly entries: ReadonlyArray<ColumnFocusEntry>;
  readonly focusedKey: string;
  readonly pane: Pane;
  readonly paneIndex: number;
  readonly registerRow: (
    key: string,
    isCurrent: boolean,
  ) => (element: HTMLButtonElement | null) => void;
  readonly onChoose: (forkId: MercurianCommitId, childId: MercurianCommitId) => void;
  readonly onJumpToMerge: (mergeCommitId: MercurianCommitId) => void;
  readonly onRovingKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    entry: ColumnFocusEntry,
  ) => void;
  readonly onFocusKey: (key: string) => void;
}) {
  const terminal = pane.terminal;
  if (terminal.kind === "leaf" || terminal.kind === "merge-entry") return null;

  const forkId = pane.rows.at(-1)?.commitId;
  if (forkId === undefined) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5 px-1">
      <div className="mb-0.5 flex h-6 items-center gap-2 px-1 text-[11px] text-muted-foreground/70">
        <span aria-hidden className="h-px flex-1 bg-border/65" />
        <span className="flex items-center gap-1">
          <span>forks</span>
          <ArrowDownIcon aria-hidden className="size-3" />
        </span>
        <span aria-hidden className="h-px flex-1 bg-border/65" />
      </div>
      {terminal.options.map((option, optionIndex) => {
        const isChosen = option.branchRootId === terminal.chosenChildId;
        const key = branchFocusKey(paneIndex, option.branchRootId);
        const entry = entries[pane.rows.length + optionIndex]!;
        if (option.onPathMerge && !isChosen) {
          return (
            <button
              aria-label={`Jump to merge ${option.summary}`}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground outline-hidden hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              key={option.branchRootId}
              ref={registerRow(key, false)}
              tabIndex={focusedKey === key ? 0 : -1}
              type="button"
              onClick={() => onJumpToMerge(option.branchRootId)}
              onFocus={() => onFocusKey(key)}
              onKeyDown={(event) => onRovingKeyDown(event, entry)}
            >
              <GitMergeIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{option.summary}</span>
              <span className="shrink-0">merges ↗</span>
            </button>
          );
        }
        return (
          <button
            aria-current={isChosen ? "true" : undefined}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left outline-hidden",
              "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              isChosen && "bg-accent/50",
            )}
            key={option.branchRootId}
            ref={registerRow(key, false)}
            tabIndex={focusedKey === key ? 0 : -1}
            type="button"
            onClick={() => onChoose(forkId, option.branchRootId)}
            onFocus={() => onFocusKey(key)}
            onKeyDown={(event) => onRovingKeyDown(event, entry)}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                option.published ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {option.summary}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground/70">
              {formatRelativeTimeLabel(option.lastActiveAt)}
            </span>
            {isChosen ? (
              <CheckIcon aria-label="Current line" className="size-3.5 shrink-0" />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The semantic rows in one pane, in the same order the keyboard reads them. */
function columnFocusEntries(pane: Pane, paneIndex: number): ReadonlyArray<ColumnFocusEntry> {
  const keys = pane.rows.map((row) => commitFocusKey(row.commitId));
  if (pane.terminal.kind === "fork") {
    keys.push(
      ...pane.terminal.options.map((option) => branchFocusKey(paneIndex, option.branchRootId)),
    );
  }
  return keys.map((key, rowIndex) => ({ key, paneIndex, rowIndex }));
}

const commitFocusKey = (commitId: MercurianCommitId) => `commit:${commitId}`;
const branchFocusKey = (paneIndex: number, commitId: MercurianCommitId) =>
  `branch:${paneIndex}:${commitId}`;

/** What a compressed pane says in place of the text it has folded away. */
function paneSpanLabel(pane: Pane): string {
  const first = pane.rows[0];
  const last = pane.rows.at(-1);
  if (first === undefined || last === undefined) return "Empty checkpoint pane";
  const start = planNodeSummary(first);
  const end = planNodeSummary(last);
  return start === end ? `Checkpoints: ${start}` : `Checkpoints: ${start} to ${end}`;
}

/**
 * The spatial map: the whole DAG at once, laid out by the selected d3-dag
 * engine and drawn as one static SVG.
 *
 * The layout is solved synchronously and rendered once — nothing repaints at
 * rest. Pan and zoom are a single transform on one `<g>`, so a gesture moves
 * the map without re-solving it.
 */
function GraphView({
  graph,
  commitGraph,
  codingSessions,
  providers,
  currentCommitId,
  inFlightUnansweredNodes,
  readyCommits,
  stalePlanCommitIds,
  staleSpecCommitIds,
  onEditAndBranch,
  onImplementFrom,
  onSelect,
}: {
  readonly graph: PlanGraph;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly currentCommitId: MercurianCommitId | null;
  readonly inFlightUnansweredNodes: ReadonlySet<string>;
  readonly readyCommits: ReadonlyMap<MercurianCommitId, PlanImplementReady>;
  readonly stalePlanCommitIds: ReadonlySet<string>;
  readonly staleSpecCommitIds: ReadonlySet<string>;
  readonly onEditAndBranch: (
    query: Extract<PlanTimelineItem, { readonly _tag: "message" }>,
  ) => void;
  readonly onImplementFrom: (commitId: MercurianCommitId) => void;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const [settings, setSettings] = useLocalStorage(
    DISPLAY_SETTINGS_STORAGE_KEY,
    DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS,
    DagExplorerDisplaySettings,
  );
  const layout = useMemo(
    () => dagLayout(graph, { layout: settings.layout }),
    [graph, settings.layout],
  );

  // Deliberately not keyed on the layout: a commit landing must not throw away
  // the pan and zoom of whoever is reading the map.
  return (
    <SpatialMap
      codingSessions={codingSessions}
      commitGraph={commitGraph}
      currentCommitId={currentCommitId}
      graph={graph}
      inFlightUnansweredNodes={inFlightUnansweredNodes}
      layout={layout}
      providers={providers}
      readyCommits={readyCommits}
      settings={settings}
      stalePlanCommitIds={stalePlanCommitIds}
      staleSpecCommitIds={staleSpecCommitIds}
      onSettingsChange={setSettings}
      onEditAndBranch={onEditAndBranch}
      onImplementFrom={onImplementFrom}
      onSelect={onSelect}
    />
  );
}

function SpatialMap({
  graph,
  commitGraph,
  codingSessions,
  providers,
  layout,
  currentCommitId,
  inFlightUnansweredNodes,
  readyCommits,
  settings,
  stalePlanCommitIds,
  staleSpecCommitIds,
  onEditAndBranch,
  onImplementFrom,
  onSettingsChange,
  onSelect,
}: {
  readonly graph: PlanGraph;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly layout: SpatialLayout;
  readonly currentCommitId: MercurianCommitId | null;
  readonly inFlightUnansweredNodes: ReadonlySet<string>;
  readonly readyCommits: ReadonlyMap<MercurianCommitId, PlanImplementReady>;
  readonly settings: DagExplorerDisplaySettingsValue;
  readonly stalePlanCommitIds: ReadonlySet<string>;
  readonly staleSpecCommitIds: ReadonlySet<string>;
  readonly onEditAndBranch: (
    query: Extract<PlanTimelineItem, { readonly _tag: "message" }>,
  ) => void;
  readonly onImplementFrom: (commitId: MercurianCommitId) => void;
  readonly onSettingsChange: DisplaySettingsUpdater;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panning: boolean;
  } | null>(null);
  const [hovered, setHovered] = useState<MercurianCommitId | null>(null);
  const [focused, setFocused] = useState<MercurianCommitId | null>(null);
  const [pointerWorld, setPointerWorld] = useState<
    | (SpatialPoint & {
        readonly viewBoxUnitsPerPixel: number;
      })
    | null
  >(null);
  const [transform, setTransform] = useState<MapTransform>({ x: 0, y: 0, zoom: 1 });
  const [mapFrame, setMapFrame] = useState({
    width: 0,
    height: 0,
    svgWidth: 0,
    svgHeight: 0,
  });
  const transformRef = useRef(transform);
  const [renderLayout, setRenderLayout] = useState(() => settledSpatialLayout(layout));
  const renderLayoutRef = useRef(renderLayout);
  const solvedLayoutRef = useRef(layout);
  const [startTween, cancelTween] = useTween();
  const popover = usePlanNodePopover();

  useEffect(() => {
    const container = mapContainerRef.current;
    if (container === null) return;

    const observer = new ResizeObserver(([entry]) => {
      const svg = svgRef.current;
      if (entry === undefined || svg === null) return;
      const { width, height } = entry.contentRect;
      const svgRect = svg.getBoundingClientRect();
      const next = {
        width,
        height,
        svgWidth: svgRect.width,
        svgHeight: svgRect.height,
      };
      setMapFrame((current) =>
        current.width === next.width &&
        current.height === next.height &&
        current.svgWidth === next.svgWidth &&
        current.svgHeight === next.svgHeight
          ? current
          : next,
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const applyTransform = useCallback((next: MapTransform) => {
    transformRef.current = next;
    setTransform(next);
  }, []);

  const applyRenderLayout = useCallback((next: AnimatedSpatialLayout) => {
    renderLayoutRef.current = next;
    setRenderLayout(next);
  }, []);

  useEffect(() => {
    if (solvedLayoutRef.current === layout) return;
    const from = renderLayoutRef.current;
    solvedLayoutRef.current = layout;
    startTween("layout", (progress) => {
      applyRenderLayout(interpolateSpatialLayout(from, layout, progress));
    });
  }, [applyRenderLayout, layout, startTween]);

  const viewBox = useMemo<MapViewBox>(
    () => ({
      x: layout.bounds.minX - MAP_PADDING,
      y: layout.bounds.minY - MAP_PADDING,
      width: layout.bounds.maxX - layout.bounds.minX + MAP_PADDING * 2,
      height: layout.bounds.maxY - layout.bounds.minY + MAP_PADDING * 2,
    }),
    [layout.bounds],
  );

  // Where you stand comes to the middle when the position moves — the map is
  // for orientation, and orientation starts with finding yourself on it.
  const here = currentCommitId === null ? undefined : layout.positions.get(currentCommitId);
  const hereX = here?.x;
  const hereY = here?.y;
  useEffect(() => {
    if (hereX === undefined || hereY === undefined) return;
    const from = transformRef.current;
    const tween = cameraTween(from, centerOn({ x: hereX, y: hereY }, from, viewBox), viewBox);
    startTween("camera", (progress) => applyTransform(tween(progress)));
  }, [applyTransform, hereX, hereY, startTween, viewBox]);

  const unitsPerPixel = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return 1;
    // `preserveAspectRatio` letterboxes, so the tighter axis sets the scale.
    return Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
  }, [viewBox.height, viewBox.width]);

  const clientToViewBox = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect === undefined || rect.width === 0 || rect.height === 0) {
        return { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
      }
      const scale = Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
      const renderedWidth = viewBox.width / scale;
      const renderedHeight = viewBox.height / scale;
      const insetX = (rect.width - renderedWidth) / 2;
      const insetY = (rect.height - renderedHeight) / 2;
      return {
        x: viewBox.x + (clientX - rect.left - insetX) * scale,
        y: viewBox.y + (clientY - rect.top - insetY) * scale,
      };
    },
    [viewBox],
  );

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    // Deliberately not capturing yet. Capturing on press retargets the click
    // to this element, and picking a commit would stop working — the map has
    // to stay clickable, not just draggable.
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panning: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pointer = clientToViewBox(event.clientX, event.clientY);
    const currentTransform = transformRef.current;
    setPointerWorld({
      x: (pointer.x - currentTransform.x) / currentTransform.zoom,
      y: (pointer.y - currentTransform.y) / currentTransform.zoom,
      viewBoxUnitsPerPixel: unitsPerPixel(),
    });

    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (!drag.panning) {
      // A press that never moves is a pick, not a pan.
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // No active pointer to capture; panning still works without it.
      }
      drag.panning = true;
    }
    const scale = unitsPerPixel();
    const dx = (event.clientX - drag.x) * scale;
    const dy = (event.clientY - drag.y) * scale;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    try {
      if (drag.panning && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Already released; harmless.
    }
    dragRef.current = null;
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelTween("camera");
      const intent = wheelIntent({
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
      if (intent.kind === "pan") {
        const scale = unitsPerPixel();
        setTransform((current) => ({
          ...current,
          x: current.x - intent.dx * scale,
          y: current.y - intent.dy * scale,
        }));
        return;
      }

      const point = clientToViewBox(event.clientX, event.clientY);
      setTransform((current) => {
        const next = zoomAtPoint(current, intent.factor, point, viewBox);
        transformRef.current = next;
        return next;
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [cancelTween, clientToViewBox, unitsPerPixel, viewBox]);

  const emphasisId = hovered ?? focused;
  const lineage = useMemo(() => {
    if (emphasisId === null || !graph.byId.has(emphasisId)) return null;
    return new Set([
      ...ancestorClosure(graph, emphasisId),
      ...descendantClosure(graph, emphasisId),
    ]);
  }, [emphasisId, graph]);
  const currentPath = useMemo(
    () => (currentCommitId === null ? new Set<string>() : ancestorClosure(graph, currentCommitId)),
    [currentCommitId, graph],
  );
  const detail = detailFor(transform.zoom);
  const fitToView = () => {
    const from = transformRef.current;
    const tween = cameraTween(from, fitTransform(layout.bounds, viewBox), viewBox);
    startTween("camera", (progress) => applyTransform(tween(progress)));
  };

  const jumpToCurrent = () => {
    if (hereX === undefined || hereY === undefined) return;
    const from = transformRef.current;
    const tween = cameraTween(from, centerOn({ x: hereX, y: hereY }, from, viewBox), viewBox);
    startTween("camera", (progress) => applyTransform(tween(progress)));
  };

  const recenterFromMinimap = (point: MapPoint, animate: boolean) => {
    const from = transformRef.current;
    const target = centerOn(point, from, viewBox);
    if (!animate) {
      cancelTween("camera");
      applyTransform(target);
      return;
    }
    const tween = cameraTween(from, target, viewBox);
    startTween("camera", (progress) => applyTransform(tween(progress)));
  };

  const renderedFrame = useMemo<MapFrameSize>(
    () => ({ width: mapFrame.svgWidth, height: mapFrame.svgHeight }),
    [mapFrame.svgHeight, mapFrame.svgWidth],
  );
  const mapIsOverflowing = mapOverflows(layout.bounds, transform, viewBox, renderedFrame);
  const overviewSize = useMemo(
    () => minimapSize(mapFrame.width, mapFrame.height),
    [mapFrame.height, mapFrame.width],
  );

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" ref={mapContainerRef}>
      <svg
        className="size-full cursor-grab touch-none active:cursor-grabbing"
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerLeave={() => setPointerWorld(null)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.zoom})`}>
          {renderLayout.edges.map((edge) => {
            const isCurrentPath =
              currentPath.has(edge.fromCommitId) && currentPath.has(edge.toCommitId);
            const isDimmed =
              lineage !== null &&
              (!lineage.has(edge.fromCommitId) || !lineage.has(edge.toCommitId));
            return (
              <polyline
                className={cn(
                  "fill-none transition-opacity duration-150",
                  isCurrentPath ? "stroke-foreground" : "stroke-border",
                  isDimmed && "opacity-[0.18]",
                )}
                key={`${edge.fromCommitId}->${edge.toCommitId}`}
                points={polylinePoints(edge.points)}
                strokeWidth={edgeWidthFor(isCurrentPath, settings)}
              />
            );
          })}
          {renderLayout.nodes.map((node) => {
            const isCurrent = node.commitId === currentCommitId;
            const graphNode = graph.byId.get(node.commitId);
            if (graphNode === undefined) return null;
            const distanceToPointer =
              pointerWorld === null
                ? Number.POSITIVE_INFINITY
                : (Math.hypot(node.x - pointerWorld.x, node.y - pointerWorld.y) * transform.zoom) /
                  pointerWorld.viewBoxUnitsPerPixel;
            const radius = radiusFor(graphNode, settings) * proximityScale(distanceToPointer);
            const isDimmed = lineage !== null && !lineage.has(node.commitId);
            const isPlanStale = stalePlanCommitIds.has(node.commitId);
            const isSpecStale = staleSpecCommitIds.has(node.commitId);
            const statusDots = planNodeStatusDots({
              ready: readyCommits.has(node.commitId),
              staleSpec: isSpecStale,
              stalePlan: isPlanStale,
            });
            const statusDotRadius = radius * 0.35;
            const statusDotAnchor = radius / Math.SQRT2;
            const Glyph =
              graphNode.checkpoint === undefined ? commitGlyph(node.item) : MessagesSquareIcon;
            const interaction = graphNodePopoverInteraction({
              acts: offeredActs(graphNode, commitGraph),
              commitId: node.commitId,
              popover,
              onSelect,
            });
            return (
              <g
                // A node is a control, and a circle has no accessible name of
                // its own: without this the map is unreadable to a screen
                // reader and unreachable by keyboard.
                aria-label={`${planNodeAccessibleLabel(graphNode)}${isSpecStale ? ", spec stale" : ""}${isPlanStale ? `, ${PLAN_MAY_BE_STALE_LABEL.toLowerCase()}` : ""}`}
                aria-current={isCurrent ? "true" : undefined}
                aria-haspopup="dialog"
                className="cursor-pointer transition-opacity duration-150"
                data-commit-id={node.commitId}
                key={node.commitId}
                onClick={(event) => interaction.activate(event.currentTarget)}
                onBlur={() => {
                  setFocused((at) => (at === node.commitId ? null : at));
                  interaction.scheduleClose();
                }}
                onFocus={(event) => {
                  setFocused(node.commitId);
                  interaction.linger(event.currentTarget);
                }}
                onPointerEnter={(event) => {
                  setHovered(node.commitId);
                  interaction.linger(event.currentTarget);
                }}
                onPointerLeave={() => {
                  setHovered((at) => (at === node.commitId ? null : at));
                  interaction.scheduleClose();
                }}
                role="button"
                style={{ opacity: node.opacity * (isDimmed ? 0.18 : 1) }}
                tabIndex={0}
                transform={`translate(${node.x} ${node.y}) scale(${node.scale}) translate(${-node.x} ${-node.y})`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    interaction.activate(event.currentTarget);
                  }
                }}
              >
                {isCurrent ? (
                  <circle
                    className="current-position-ring fill-none stroke-primary"
                    cx={node.x}
                    cy={node.y}
                    r={radius + 4}
                    strokeWidth={2}
                  />
                ) : null}
                <circle
                  className={
                    node.item.published
                      ? "fill-muted-foreground stroke-none"
                      : "fill-background stroke-muted-foreground"
                  }
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  strokeWidth={1.5}
                />
                {graphNode.checkpoint === undefined ? null : (
                  <circle
                    className={cn(
                      "checkpoint-ring fill-none",
                      node.item.published ? "stroke-background/80" : "stroke-muted-foreground",
                    )}
                    cx={node.x}
                    cy={node.y}
                    r={Math.max(radius - 3, 1)}
                    strokeWidth={1}
                  />
                )}
                {detail === "dot" ? null : (
                  <g transform={graphMessageGlyphTransform(graphNode, node.x)}>
                    <Glyph
                      className={cn(
                        "pointer-events-none",
                        node.item.published ? "text-background" : "text-muted-foreground",
                      )}
                      height={radius}
                      strokeWidth={3}
                      width={radius}
                      x={node.x - radius / 2}
                      y={node.y - radius / 2}
                    />
                  </g>
                )}
                {statusDots.map((dot, index) => (
                  <circle
                    className={cn("node-status-dot pointer-events-none", dot.fillClass)}
                    data-status={dot.key}
                    cx={node.x + statusDotAnchor + index * statusDotRadius * 2.1}
                    cy={node.y - statusDotAnchor}
                    key={dot.key}
                    r={statusDotRadius}
                  />
                ))}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute right-2 top-2 z-20 flex items-center rounded-md border border-border bg-background/90 p-0.5 shadow-sm">
        <DisplaySettingsPopover settings={settings} onSettingsChange={onSettingsChange} />
      </div>
      <ActivePlanNodePopover
        codingSessions={codingSessions}
        commitGraph={commitGraph}
        controller={popover}
        graph={graph}
        inFlightUnansweredNodes={inFlightUnansweredNodes}
        providers={providers}
        readyCommits={readyCommits}
        stalePlanCommitIds={stalePlanCommitIds}
        staleSpecCommitIds={staleSpecCommitIds}
        onEditAndBranch={onEditAndBranch}
        onImplementFrom={onImplementFrom}
        onSelect={onSelect}
      />
      <div className="absolute right-2 bottom-2 z-20 flex flex-col items-end gap-1">
        <div className="flex items-center rounded-md border border-border bg-background/90 p-0.5 shadow-sm">
          {mapIsOverflowing ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Fit graph to view"
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                    onClick={fitToView}
                  />
                }
              >
                <Maximize2Icon />
              </TooltipTrigger>
              <TooltipPopup>Fit graph to view</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Jump to current commit"
                  disabled={hereX === undefined || hereY === undefined}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={jumpToCurrent}
                />
              }
            >
              <LocateFixedIcon />
            </TooltipTrigger>
            <TooltipPopup>Jump to current commit</TooltipPopup>
          </Tooltip>
        </div>
        {mapIsOverflowing ? (
          <Minimap
            currentCommitId={currentCommitId}
            frame={renderedFrame}
            layout={renderLayout}
            size={overviewSize}
            transform={transform}
            viewBox={viewBox}
            onCenter={recenterFromMinimap}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The map in miniature: the same polylines, plus the frame currently visible. */
function Minimap({
  layout,
  currentCommitId,
  frame,
  size,
  transform,
  viewBox,
  onCenter,
}: {
  readonly layout: SpatialLayout;
  readonly currentCommitId: MercurianCommitId | null;
  readonly frame: MapFrameSize;
  readonly size: MinimapSize;
  readonly transform: MapTransform;
  readonly viewBox: MapViewBox;
  readonly onCenter: (point: MapPoint, animate: boolean) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    moved: boolean;
  } | null>(null);
  const projection = useMemo(() => minimapProjection(layout.bounds, size), [layout.bounds, size]);
  const visible = visibleWorldRect(transform, viewBox, frame);
  const visibleTopLeft = projection.project({ x: visible.minX, y: visible.minY });
  const visibleBottomRight = projection.project({ x: visible.maxX, y: visible.maxY });

  const clientToMinimap = (clientX: number, clientY: number): MapPoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) {
      return { x: size.width / 2, y: size.height / 2 };
    }
    return {
      x: ((clientX - rect.left) / rect.width) * size.width,
      y: ((clientY - rect.top) / rect.height) * size.height,
    };
  };

  const centerAtPointer = (event: ReactPointerEvent<SVGSVGElement>, animate: boolean) => {
    const point = clientToMinimap(event.clientX, event.clientY);
    onCenter(minimapPointToWorld(point, projection), animate);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No active pointer to capture; a clean click still works without it.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      drag.moved =
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= DRAG_THRESHOLD;
    }
    if (drag.moved) centerAtPointer(event, false);
  };

  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>, flyOnClick: boolean) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      centerAtPointer(event, false);
    } else if (flyOnClick) {
      centerAtPointer(event, true);
    }
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Already released; harmless.
    }
    dragRef.current = null;
  };

  return (
    <svg
      aria-label="Map overview"
      className="cursor-crosshair rounded-md border border-border bg-background/90 shadow-sm"
      height={size.height}
      ref={svgRef}
      viewBox={`0 0 ${size.width} ${size.height}`}
      width={size.width}
      onPointerCancel={(event) => finishDrag(event, false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event, true)}
    >
      {layout.edges.map((edge) => (
        <polyline
          className="fill-none stroke-border"
          key={`${edge.fromCommitId}->${edge.toCommitId}`}
          points={polylinePoints(edge.points.map(projection.project))}
          strokeWidth={0.75}
        />
      ))}
      {layout.nodes.map((node) => {
        const point = projection.project(node);
        return (
          <circle
            className={node.commitId === currentCommitId ? "fill-primary" : "fill-muted-foreground"}
            cx={point.x}
            cy={point.y}
            key={node.commitId}
            r={2}
          />
        );
      })}
      <rect
        className="fill-primary/10 stroke-primary"
        height={visibleBottomRight.y - visibleTopLeft.y}
        width={visibleBottomRight.x - visibleTopLeft.x}
        x={visibleTopLeft.x}
        y={visibleTopLeft.y}
        strokeWidth={1}
      />
    </svg>
  );
}

interface ActiveTween {
  readonly startedAt: number;
  readonly duration: number;
  readonly render: (progress: number) => void;
}

/** One finite frame loop shared by every map transition. */
function useTween() {
  const activeRef = useRef(new Map<string, ActiveTween>());
  const frameRef = useRef<number | null>(null);

  const tick = useCallback(function tick(now: number) {
    for (const [key, tween] of activeRef.current) {
      const progress = Math.min((now - tween.startedAt) / tween.duration, 1);
      tween.render(progress);
      if (progress >= 1) activeRef.current.delete(key);
    }

    if (activeRef.current.size === 0) {
      frameRef.current = null;
      return;
    }
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(
    (key: string, render: (progress: number) => void) => {
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : MAP_TWEEN_DURATION;
      activeRef.current.delete(key);
      if (duration === 0) {
        render(1);
        return;
      }

      activeRef.current.set(key, { duration, render, startedAt: performance.now() });
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(tick);
    },
    [tick],
  );

  const cancel = useCallback((key: string) => {
    activeRef.current.delete(key);
    if (activeRef.current.size > 0 || frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      activeRef.current.clear();
    },
    [],
  );

  return [start, cancel] as const;
}

type AnimatedSpatialNode = SpatialNode & {
  readonly opacity: number;
  readonly scale: number;
};

type AnimatedSpatialLayout = Omit<SpatialLayout, "nodes"> & {
  readonly nodes: ReadonlyArray<AnimatedSpatialNode>;
};

function settledSpatialLayout(layout: SpatialLayout): AnimatedSpatialLayout {
  return {
    ...layout,
    nodes: layout.nodes.map((node) => ({ ...node, opacity: 1, scale: 1 })),
  };
}

function interpolateSpatialLayout(
  from: AnimatedSpatialLayout,
  to: SpatialLayout,
  progress: number,
): AnimatedSpatialLayout {
  if (progress >= 1) return settledSpatialLayout(to);
  const eased = 1 - (1 - progress) ** 3;
  const fromById = new Map(from.nodes.map((node) => [node.commitId as string, node]));
  const positions = new Map<string, SpatialPoint>();
  const nodes = to.nodes.map((node): AnimatedSpatialNode => {
    const previous = fromById.get(node.commitId);
    const x = previous === undefined ? node.x : previous.x + (node.x - previous.x) * eased;
    const y = previous === undefined ? node.y : previous.y + (node.y - previous.y) * eased;
    positions.set(node.commitId, { x, y });
    return {
      ...node,
      x,
      y,
      opacity: previous === undefined ? eased : previous.opacity + (1 - previous.opacity) * eased,
      scale: previous === undefined ? eased : previous.scale + (1 - previous.scale) * eased,
    };
  });
  const fromEdgesById = new Map(
    from.edges.map((edge) => [`${edge.fromCommitId}\0${edge.toCommitId}`, edge]),
  );
  const edges = to.edges.map((edge) => {
    const fromPoint = positions.get(edge.fromCommitId)!;
    const toPoint = positions.get(edge.toCommitId)!;
    const previous = fromEdgesById.get(`${edge.fromCommitId}\0${edge.toCommitId}`);
    const points =
      previous !== undefined && previous.points.length === edge.points.length
        ? edge.points.map((point, index) => {
            if (index === 0) return fromPoint;
            if (index === edge.points.length - 1) return toPoint;
            const oldPoint = previous.points[index]!;
            return {
              x: oldPoint.x + (point.x - oldPoint.x) * eased,
              y: oldPoint.y + (point.y - oldPoint.y) * eased,
            };
          })
        : [fromPoint, toPoint];
    return {
      ...edge,
      points,
    };
  });
  return { ...to, edges, nodes, positions };
}

/**
 * What a commit looks like at a glance. One glyph per kind, shared by the map
 * and the list so a commit reads the same in both.
 */
function commitGlyph(item: PlanTimelineItem) {
  if (item._tag === "coding-session") return SquareTerminalIcon;
  if (item._tag === "plan-revision") return FileTextIcon;
  if (item._tag === "spec-revision") return CircleDotIcon;
  return MessageSquareIcon;
}

function messageAuthorLabel(item: Extract<PlanTimelineItem, { readonly _tag: "message" }>): string {
  return item.authorKind === "human" ? "You" : "Assistant";
}

function MessageAuthorGlyph({
  item,
  className,
}: {
  readonly item: Extract<PlanTimelineItem, { readonly _tag: "message" }>;
  readonly className?: string;
}) {
  return (
    <MessageSquareIcon
      aria-hidden
      className={cn(className, item.authorKind === "human" && "-scale-x-100")}
    />
  );
}

function planNodeAccessibleLabel(node: PlanGraphNode): string {
  const checkpoint = node.checkpoint;
  if (checkpoint !== undefined) {
    const query = `You: ${planCommitSummary(checkpoint.query)}`;
    const response =
      checkpoint.response === undefined
        ? ""
        : `; Assistant: ${planCommitSummary(checkpoint.response)}`;
    return `${query}${response}`;
  }
  if (node.item._tag === "message") {
    return `${messageAuthorLabel(node.item)}: ${planCommitSummary(node.item)}`;
  }
  return planCommitSummary(node.item);
}

function graphMessageGlyphTransform(node: PlanGraphNode, x: number): string | undefined {
  return node.checkpoint === undefined &&
    node.item._tag === "message" &&
    node.item.authorKind === "human"
    ? `translate(${x * 2} 0) scale(-1,1)`
    : undefined;
}

interface PlanNodeRowProps {
  readonly node: PlanGraphNode;
  readonly popover: PlanNodePopoverController;
  readonly isCurrent: boolean;
  readonly ready: boolean;
  readonly stalePlan?: boolean;
  readonly staleSpec?: boolean;
  readonly suppressUnanswered?: boolean;
  readonly trailing: ReactNode;
  readonly onSelect: (commitId: MercurianCommitId) => void;
  readonly onFocus?: () => void;
  readonly onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  readonly ref?: Ref<HTMLButtonElement> | undefined;
  readonly tabIndex?: number;
}

function PlanNodeRow(props: PlanNodeRowProps) {
  return props.node.checkpoint === undefined ? (
    <CommitRow {...props} />
  ) : (
    <CheckpointRow {...props} />
  );
}

function CheckpointRow({
  node,
  popover,
  isCurrent,
  ready,
  stalePlan = false,
  staleSpec = false,
  suppressUnanswered = false,
  trailing,
  onSelect,
  onFocus,
  onKeyDown,
  ref,
  tabIndex,
}: PlanNodeRowProps) {
  const checkpoint = node.checkpoint;
  if (checkpoint === undefined) return null;
  const effects = suppressUnanswered
    ? checkpoint.effects.filter((effect) => effect !== "unanswered")
    : checkpoint.effects;
  const query = checkpoint.query;
  const response = checkpoint.response;

  return (
    <div
      className={cn(
        "group/node flex w-full items-stretch gap-2 rounded-md px-2 py-1.5",
        "hover:bg-accent/50",
        isCurrent && "bg-accent",
      )}
      onPointerEnter={(event) => popover.linger(node.commitId, event.currentTarget)}
      onPointerLeave={popover.scheduleClose}
    >
      <button
        aria-current={isCurrent ? "true" : undefined}
        aria-label={planNodeAccessibleLabel(node)}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-md text-left ring-ring outline-hidden focus-visible:ring-2"
        data-commit-id={node.commitId}
        ref={ref}
        tabIndex={tabIndex}
        type="button"
        onClick={() => {
          popover.close();
          onSelect(node.commitId);
        }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        <span className="flex min-w-0 w-full items-center justify-end gap-1.5 text-right">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              query.published ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {planCommitSummary(query)}
          </span>
          {query._tag === "message" ? (
            <MessageAuthorGlyph
              className={cn(
                "size-3.5 shrink-0",
                query.published ? "text-foreground" : "text-muted-foreground/70",
              )}
              item={query}
            />
          ) : null}
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">You</span>
        </span>
        {effects.length === 0 && !ready && !stalePlan && !staleSpec ? null : (
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {effects.map((effect) => (
              <span
                className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                key={effect}
              >
                {planCheckpointEffectLabel(effect)}
              </span>
            ))}
            {ready ? (
              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                Ready to implement
              </span>
            ) : null}
            {staleSpec ? (
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                Spec stale
              </span>
            ) : null}
            {stalePlan ? (
              <span
                className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                title={PLAN_MAY_BE_STALE_DESCRIPTION}
              >
                {PLAN_MAY_BE_STALE_LABEL}
              </span>
            ) : null}
          </span>
        )}
        {response?._tag === "message" ? (
          <span className="flex min-w-0 w-full items-center gap-1.5">
            <MessageAuthorGlyph
              className={cn(
                "size-3.5 shrink-0",
                response.published ? "text-foreground" : "text-muted-foreground/70",
              )}
              item={response}
            />
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
              Assistant
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                response.published ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {planCommitSummary(response)}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground/70">
              {formatRelativeTimeLabel(response.createdAt)}
            </span>
          </span>
        ) : null}
      </button>
      {trailing}
      <PlanNodeDetailsButton controller={popover} node={node} />
    </div>
  );
}

/**
 * One commit, as the thread shows it: what it was, what it said, and when.
 *
 * Published work reads solid and private work muted — the same distinction the
 * dots draw, carried into the row so the text makes it too.
 */
function CommitRow({
  node,
  popover,
  isCurrent,
  ready,
  stalePlan = false,
  staleSpec = false,
  trailing,
  onSelect,
  onFocus,
  onKeyDown,
  ref,
  tabIndex,
}: PlanNodeRowProps) {
  const item = node.item;
  const Glyph = commitGlyph(item);

  return (
    <div
      className={cn(
        "group/node flex w-full items-center gap-2 rounded-md px-2",
        "hover:bg-accent/50",
        isCurrent && "bg-accent",
      )}
      style={{ height: `${ROW_HEIGHT}px` }}
      onPointerEnter={(event) => popover.linger(node.commitId, event.currentTarget)}
      onPointerLeave={popover.scheduleClose}
    >
      <button
        aria-current={isCurrent ? "true" : undefined}
        aria-label={planNodeAccessibleLabel(node)}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md text-left ring-ring outline-hidden focus-visible:ring-2"
        ref={ref}
        tabIndex={tabIndex}
        type="button"
        onClick={() => {
          popover.close();
          onSelect(node.commitId);
        }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        {item._tag === "message" ? (
          <MessageAuthorGlyph
            className={cn(
              "size-3.5 shrink-0",
              item.published ? "text-foreground" : "text-muted-foreground/70",
            )}
            item={item}
          />
        ) : (
          <Glyph
            className={cn(
              "size-3.5 shrink-0",
              item.published ? "text-foreground" : "text-muted-foreground/70",
            )}
          />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            item.published ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {planCommitSummary(item)}
        </span>
        {ready ? (
          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
            Ready to implement
          </span>
        ) : null}
        {staleSpec ? (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            Spec stale
          </span>
        ) : null}
        {stalePlan ? (
          <span
            className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
            title={PLAN_MAY_BE_STALE_DESCRIPTION}
          >
            {PLAN_MAY_BE_STALE_LABEL}
          </span>
        ) : null}
        <span className="shrink-0 text-[11px] text-muted-foreground/70">
          {formatRelativeTimeLabel(item.createdAt)}
        </span>
      </button>
      {trailing}
      <PlanNodeDetailsButton controller={popover} node={node} />
    </div>
  );
}

/**
 * Bring where you stand into view when the thread opens and whenever the
 * position moves. One scroll, not a smooth-scrolling loop.
 */
function useCurrentRowScroll(currentCommitId: MercurianCommitId | null) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [currentCommitId]);

  return ref;
}

const polylinePoints = (points: ReadonlyArray<SpatialPoint>) =>
  points.map(({ x, y }) => `${x},${y}`).join(" ");
