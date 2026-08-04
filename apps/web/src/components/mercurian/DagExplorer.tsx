import type { MercurianCommitId, PlanTimelineItem } from "@t3tools/contracts";
import { FileTextIcon, GitForkIcon, MessageSquareIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useEffect, useRef, type ReactNode, type Ref } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  graphLayout,
  navigatorRows,
  planCommitSummary,
  type PlanGraph,
  type PlanGraphLayout,
  type NavigatorRow,
} from "./PlanGraph.logic";

const EXPLORER_VIEW_STORAGE_KEY = "mercurian:dag-explorer-view:v1";
const ExplorerView = Schema.Literals(["navigator", "graph"]);
type ExplorerView = typeof ExplorerView.Type;
const DEFAULT_EXPLORER_VIEW: ExplorerView = "navigator";

/** One row of either view, so the rail's geometry and the list's agree. */
const ROW_HEIGHT = 34;
const LANE_WIDTH = 16;
const RAIL_INSET = 12;

/**
 * The DAG explorer: the plan's whole history, in the two readings the design
 * settled on — a compact Navigator for orientation and movement, and a full
 * git-graph for the shape.
 *
 * It carries no subscription of its own. Every commit it draws comes from the
 * timeline the planning space already holds, which is why a commit landing in
 * another window shows up here, in the conversation, and in the artifact at
 * the same moment.
 *
 * Picking a commit navigates and nothing else: selection moves the planning
 * surface, the explorer highlights where you stand, and nothing is destroyed
 * by moving.
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
            if (chosen === "navigator" || chosen === "graph") {
              setView(chosen);
            }
          }}
        >
          <Toggle aria-label="Navigator view" value="navigator">
            Navigator
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
      ) : view === "navigator" ? (
        <NavigatorView
          currentCommitId={currentCommitId}
          rows={navigatorRows(graph)}
          onSelect={onSelect}
        />
      ) : (
        <GraphView
          currentCommitId={currentCommitId}
          layout={graphLayout(graph)}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}

/**
 * The tree-style reading. A merge belongs under each of its parents, so it
 * appears once as the real node and once per further parent as a marked
 * reference that jumps to it.
 */
function NavigatorView({
  rows,
  currentCommitId,
  onSelect,
}: {
  readonly rows: ReadonlyArray<NavigatorRow>;
  readonly currentCommitId: MercurianCommitId | null;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const scrollRef = useCurrentRowScroll(currentCommitId);

  return (
    <div className="min-h-0 flex-1 overflow-auto py-2">
      <ol className="flex flex-col">
        {rows.map((row) => (
          <li key={row.rowId} style={{ paddingLeft: `${12 + row.depth * 14}px` }}>
            <CommitRow
              isCurrent={!row.isReference && row.commitId === currentCommitId}
              item={row.item}
              ref={!row.isReference && row.commitId === currentCommitId ? scrollRef : undefined}
              trailing={
                row.isReference ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    jump to merge
                  </span>
                ) : row.isBranchPoint ? (
                  <GitForkIcon className="size-3 shrink-0 text-muted-foreground/70" />
                ) : null
              }
              isReference={row.isReference}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The full git-graph. Lanes and edges are drawn as one inline SVG rail behind
 * the same rows the navigator uses — no canvas, no animation loop, and no
 * graph dependency for a history a person can read.
 */
function GraphView({
  layout,
  currentCommitId,
  onSelect,
}: {
  readonly layout: PlanGraphLayout;
  readonly currentCommitId: MercurianCommitId | null;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const scrollRef = useCurrentRowScroll(currentCommitId);
  const railWidth = RAIL_INSET * 2 + Math.max(0, layout.laneCount - 1) * LANE_WIDTH;
  const laneX = (lane: number) => RAIL_INSET + lane * LANE_WIDTH;
  const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

  return (
    <div className="min-h-0 flex-1 overflow-auto py-2">
      <div className="relative">
        <svg
          aria-hidden
          className="pointer-events-none absolute top-0 left-0"
          height={layout.rows.length * ROW_HEIGHT}
          width={railWidth}
        >
          {layout.edges.map((edge) => (
            <path
              className="fill-none stroke-border"
              d={edgePath(
                laneX(edge.fromLane),
                rowY(edge.fromRow),
                laneX(edge.toLane),
                rowY(edge.toRow),
              )}
              key={`${edge.fromCommitId}->${edge.toCommitId}`}
              strokeWidth={1.5}
            />
          ))}
          {layout.rows.map((row) => (
            <circle
              // Solid is shared history, hollow is private work still your own.
              className={cn(
                "stroke-muted-foreground",
                row.item.published ? "fill-muted-foreground" : "fill-background",
              )}
              cx={laneX(row.lane)}
              cy={rowY(row.row)}
              key={row.commitId}
              r={4}
              strokeWidth={1.5}
            />
          ))}
        </svg>
        <ol className="flex flex-col">
          {layout.rows.map((row) => (
            <li key={row.commitId} style={{ paddingLeft: `${railWidth}px` }}>
              <CommitRow
                isCurrent={row.commitId === currentCommitId}
                item={row.item}
                ref={row.commitId === currentCommitId ? scrollRef : undefined}
                trailing={
                  row.isBranchPoint ? (
                    <GitForkIcon className="size-3 shrink-0 text-muted-foreground/70" />
                  ) : null
                }
                isReference={false}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * One commit, as either view shows it: what it was, what it said, and when.
 *
 * Private work reads muted and unpublished work reads solid — the same
 * distinction the graph's dots draw, carried into the row so the navigator
 * makes it too.
 */
function CommitRow({
  item,
  isCurrent,
  isReference,
  trailing,
  onSelect,
  ref,
}: {
  readonly item: PlanTimelineItem;
  readonly isCurrent: boolean;
  readonly isReference: boolean;
  readonly trailing: ReactNode;
  readonly onSelect: (commitId: MercurianCommitId) => void;
  readonly ref?: Ref<HTMLButtonElement> | undefined;
}) {
  const Glyph = item._tag === "plan-revision" ? FileTextIcon : MessageSquareIcon;

  return (
    <button
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 text-left ring-ring outline-hidden focus-visible:ring-2",
        "hover:bg-accent/50",
        isCurrent && "bg-accent",
        isReference && "opacity-70",
      )}
      ref={ref}
      style={{ height: `${ROW_HEIGHT}px` }}
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
      {trailing}
      <span className="shrink-0 text-[11px] text-muted-foreground/70">
        {formatRelativeTimeLabel(item.createdAt)}
      </span>
    </button>
  );
}

/**
 * Bring where you stand into view when the explorer opens and whenever the
 * position moves. One scroll, not a smooth-scrolling loop.
 */
function useCurrentRowScroll(currentCommitId: MercurianCommitId | null) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [currentCommitId]);

  return ref;
}

/**
 * Parent to child: straight down its own lane, and a curve across when the
 * child sits on another one.
 */
function edgePath(fromX: number, fromY: number, toX: number, toY: number): string {
  if (fromX === toX) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  const midY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}
