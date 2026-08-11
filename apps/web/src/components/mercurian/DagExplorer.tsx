import type { MercurianCommitId, PlanTimelineItem } from "@t3tools/contracts";
import {
  CheckIcon,
  CircleDotIcon,
  FileCode2Icon,
  FileTextIcon,
  GitForkIcon,
  GitMergeIcon,
  MessageSquareIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  planCommitSummary,
  spatialLayout,
  type PlanGraph,
  type SpatialLayout,
  type SpatialPoint,
} from "./PlanGraph.logic";
import {
  branchOption,
  threadLayout,
  type BranchOption,
  type ThreadSwitch,
} from "./PlanThread.logic";

const EXPLORER_VIEW_STORAGE_KEY = "mercurian:dag-explorer-view:v1";
const ExplorerView = Schema.Literals(["thread", "graph"]);
type ExplorerView = typeof ExplorerView.Type;
const DEFAULT_EXPLORER_VIEW: ExplorerView = "thread";

/** One thread row, shared by the list and its current-row scrolling. */
const ROW_HEIGHT = 34;

const MAP_PADDING = 64;
const MAP_MIN_ZOOM = 0.3;
const MAP_MAX_ZOOM = 3;
const MAP_NODE_RADIUS = 6;
/** How far the pointer has to travel before a press counts as a pan. */
const DRAG_THRESHOLD = 4;

/**
 * The DAG explorer: the plan's whole history, in the two readings the design
 * settled on.
 *
 * The **Thread** is the checked-out root-to-tip path through where the planning
 * surface stands. Rows make that line easy to read and move through, while
 * always-visible switches reveal its sibling branches and merge parents. The
 * **Graph** is the spatial map: every commit a node, every parent edge drawn,
 * the whole shape visible at once — for seeing structure, not for walking it.
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
  onSelect,
}: {
  readonly graph: PlanGraph;
  /** Where the surface is looking, or `null` when it is looking at now. */
  readonly anchoredCommitId: MercurianCommitId | null;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const [view, setView] = useLocalStorage(
    EXPLORER_VIEW_STORAGE_KEY,
    DEFAULT_EXPLORER_VIEW,
    ExplorerView,
  );
  // Standing at the tip is standing at the latest commit; an anchor is what
  // moves the highlight anywhere else.
  const currentCommitId = anchoredCommitId ?? graph.latest;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <h2 className="text-sm font-medium text-foreground">History</h2>
        <span className="min-w-0 flex-1" />
        <ToggleGroup
          className="shrink-0"
          size="xs"
          value={[view]}
          variant="outline"
          onValueChange={(next) => {
            const chosen = next[0];
            // The switch is a choice between two views, never a way to have
            // neither: re-pressing the active one leaves it pressed.
            if (chosen === "thread" || chosen === "graph") {
              setView(chosen);
            }
          }}
        >
          <Toggle aria-label="Thread view" value="thread">
            Thread
          </Toggle>
          <Toggle aria-label="Graph view" value="graph">
            Graph
          </Toggle>
        </ToggleGroup>
      </div>
      {graph.nodes.length === 0 ? (
        <div className="min-h-0 flex-1 px-3 py-6 sm:px-4">
          <p className="text-sm text-muted-foreground/70">Nothing has happened here yet.</p>
        </div>
      ) : view === "thread" ? (
        <ThreadView currentCommitId={currentCommitId} graph={graph} onSelect={onSelect} />
      ) : (
        <GraphView currentCommitId={currentCommitId} graph={graph} onSelect={onSelect} />
      )}
    </section>
  );
}

/**
 * The checked-out thread: one plain root-to-tip list, with switches only where
 * that line diverges from siblings or converges at a merge.
 */
function ThreadView({
  graph,
  currentCommitId,
  onSelect,
}: {
  readonly graph: PlanGraph;
  readonly currentCommitId: MercurianCommitId | null;
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

  return (
    <div className="min-h-0 flex-1 overflow-auto py-2">
      <ol className="flex flex-col">
        {layout.rows.map((row) => (
          <li key={row.commitId}>
            <CommitRow
              isCurrent={row.commitId === currentCommitId}
              item={row.item}
              ref={row.commitId === currentCommitId ? scrollRef : undefined}
              trailing={
                row.siblings !== undefined || row.parentLines !== undefined ? (
                  <span className="flex shrink-0 items-center gap-1">
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

/**
 * The spatial map: the whole DAG at once, laid out by `spatialLayout` and drawn
 * as one static SVG.
 *
 * The layout is solved synchronously to a fixed budget and rendered once —
 * nothing repaints at rest, and there is no simulation ticking in the
 * background. Pan and zoom are a single transform on one `<g>`, so a gesture
 * moves the map without re-solving it.
 *
 * `prior` positions live here, in per-window state like the position anchor
 * itself: when a commit lands the map drifts locally instead of rearranging
 * itself under someone who was reading it.
 */
function GraphView({
  graph,
  currentCommitId,
  onSelect,
}: {
  readonly graph: PlanGraph;
  readonly currentCommitId: MercurianCommitId | null;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const priorRef = useRef<ReadonlyMap<string, SpatialPoint> | undefined>(undefined);
  const layout = useMemo(() => spatialLayout(graph, priorRef.current), [graph]);
  useEffect(() => {
    priorRef.current = layout.positions;
  }, [layout]);

  // Deliberately not keyed on the layout: a commit landing must not throw away
  // the pan and zoom of whoever is reading the map.
  return <SpatialMap currentCommitId={currentCommitId} layout={layout} onSelect={onSelect} />;
}

function SpatialMap({
  layout,
  currentCommitId,
  onSelect,
}: {
  readonly layout: SpatialLayout;
  readonly currentCommitId: MercurianCommitId | null;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panning: boolean;
  } | null>(null);
  const [hovered, setHovered] = useState<MercurianCommitId | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, zoom: 1 });

  const viewBox = useMemo(
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
    setTransform((current) => ({
      ...current,
      x: viewBox.x + viewBox.width / 2 - hereX * current.zoom,
      y: viewBox.y + viewBox.height / 2 - hereY * current.zoom,
    }));
  }, [hereX, hereY, viewBox]);

  const unitsPerPixel = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return 1;
    // `preserveAspectRatio` letterboxes, so the tighter axis sets the scale.
    return Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
  }, [viewBox.height, viewBox.width]);

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

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    setTransform((current) => {
      const zoom = Math.min(
        MAP_MAX_ZOOM,
        Math.max(MAP_MIN_ZOOM, current.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)),
      );
      if (zoom === current.zoom) return current;
      // Zoom about the middle of the frame, so what you were looking at is
      // still what you are looking at.
      const centerX = viewBox.x + viewBox.width / 2;
      const centerY = viewBox.y + viewBox.height / 2;
      const ratio = zoom / current.zoom;
      return {
        zoom,
        x: centerX - (centerX - current.x) * ratio,
        y: centerY - (centerY - current.y) * ratio,
      };
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <svg
        className="size-full cursor-grab touch-none active:cursor-grabbing"
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onWheel={onWheel}
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.zoom})`}>
          {layout.edges.map((edge) => (
            <path
              className="fill-none stroke-border"
              d={mapPath(edge.fromX, edge.fromY, edge.toX, edge.toY)}
              key={`${edge.fromCommitId}->${edge.toCommitId}`}
              strokeWidth={1.5}
            />
          ))}
          {layout.nodes.map((node) => {
            const isCurrent = node.commitId === currentCommitId;
            const showLabel = isCurrent || node.commitId === hovered;
            const Glyph = commitGlyph(node.item);
            return (
              <g
                // A node is a control, and a circle has no accessible name of
                // its own: without this the map is unreadable to a screen
                // reader and unreachable by keyboard.
                aria-label={planCommitSummary(node.item)}
                aria-current={isCurrent ? "true" : undefined}
                className="cursor-pointer"
                key={node.commitId}
                onClick={() => onSelect(node.commitId)}
                onPointerEnter={() => setHovered(node.commitId)}
                onPointerLeave={() => setHovered((at) => (at === node.commitId ? null : at))}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(node.commitId);
                  }
                }}
              >
                {isCurrent ? (
                  <circle
                    className="fill-none stroke-primary"
                    cx={node.x}
                    cy={node.y}
                    r={MAP_NODE_RADIUS + 5}
                    strokeWidth={2}
                  />
                ) : null}
                <circle
                  className={cn(
                    "stroke-muted-foreground",
                    // Same distinction the navigator's dots draw: solid is
                    // shared history, hollow is private work still your own.
                    node.item.published ? "fill-muted-foreground" : "fill-background",
                  )}
                  cx={node.x}
                  cy={node.y}
                  r={MAP_NODE_RADIUS}
                  strokeWidth={1.5}
                />
                <Glyph
                  className={cn(
                    "pointer-events-none",
                    node.item.published ? "text-background" : "text-muted-foreground",
                  )}
                  height={9}
                  width={9}
                  x={node.x - 4.5}
                  y={node.y - 4.5}
                />
                {showLabel ? (
                  <text
                    className="pointer-events-none fill-foreground text-[11px]"
                    x={node.x + MAP_NODE_RADIUS + 8}
                    y={node.y + 4}
                  >
                    {planCommitSummary(node.item)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/**
 * What a commit looks like at a glance. One glyph per kind, shared by the map
 * and the list so a commit reads the same in both.
 */
function commitGlyph(item: PlanTimelineItem) {
  if (item._tag === "plan-revision") return FileTextIcon;
  if (item._tag === "technical-plan") return FileCode2Icon;
  if (item._tag === "issue-revision") return CircleDotIcon;
  return MessageSquareIcon;
}

/**
 * One commit, as the thread shows it: what it was, what it said, and when.
 *
 * Published work reads solid and private work muted — the same distinction the
 * dots draw, carried into the row so the text makes it too.
 */
function CommitRow({
  item,
  isCurrent,
  trailing,
  onSelect,
  ref,
}: {
  readonly item: PlanTimelineItem;
  readonly isCurrent: boolean;
  readonly trailing: ReactNode;
  readonly onSelect: (commitId: MercurianCommitId) => void;
  readonly ref?: Ref<HTMLButtonElement> | undefined;
}) {
  const Glyph = commitGlyph(item);

  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2",
        "hover:bg-accent/50",
        isCurrent && "bg-accent",
      )}
      style={{ height: `${ROW_HEIGHT}px` }}
    >
      <button
        aria-current={isCurrent ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md text-left ring-ring outline-hidden focus-visible:ring-2"
        ref={ref}
        type="button"
        onClick={() => onSelect(item.commitId)}
      >
        <Glyph
          className={cn(
            "size-3.5 shrink-0",
            item.published ? "text-foreground" : "text-muted-foreground/70",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            item.published ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {planCommitSummary(item)}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground/70">
          {formatRelativeTimeLabel(item.createdAt)}
        </span>
      </button>
      {trailing}
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

/** Parent to child on the map: a gentle curve, so crossing edges stay legible. */
function mapPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const midY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}
