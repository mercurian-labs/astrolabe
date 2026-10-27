import { useAtomValue } from "@effect/atom-react";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import { ThreadLineageLoader } from "@t3tools/client-runtime/state/threads";
import {
  isProviderDriverKind,
  ThreadId,
  type OrchestrationV2ThreadLineage,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useChatTabsStore } from "~/chatTabs/chatTabsStore";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useNowMinute } from "~/hooks/useNowMinute";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { formatProviderDriverKindLabel } from "~/providerModels";
import { environmentThreadDetails, environmentThreadShells } from "~/state/threads";
import { buildThreadRouteParams } from "~/threadRoutes";
import { replyLine } from "~/threadTurns";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipScrollDismissArea, TooltipTrigger } from "../ui/tooltip";
import { lineageChangeKey, lineageInput, threadActivity } from "./lineageFamily";
import {
  foldLineage,
  lineageLayout,
  type FoldedLineageLayout,
  type LineageLayout,
  type LineagePoint,
} from "./lineageLayout";
import { LineageMinimap, minimapScroll, type MinimapDot } from "./LineageMinimap";
import { labelStatus, lineTotals, turnFacts } from "./lineageText";
import { useReadingTurn } from "./readingTurn";
import { providersIgnoringCheckedAtAtom } from "~/state/server";

/** A burst of turn and title changes across the family is one refetch. */
const REFETCH_DEBOUNCE_MS = 300;

/** Changes value only when something the drawing shows does, after it settles. */
const lineageChangeAtom = Atom.family((key: string) => {
  const ref = parseScopedThreadKey(key);
  return Atom.make((get) =>
    ref === null
      ? ""
      : lineageChangeKey(
          get(environmentThreadShells.environmentThreadsAtom(ref.environmentId)),
          ref.threadId,
          get(environmentThreadDetails.threadAtom(ref))?.projection ?? null,
        ),
  ).pipe(Atom.debounce(REFETCH_DEBOUNCE_MS), Atom.withLabel(`web-lineage-change:${key}`));
});

const lineageQueryAtom = ThreadLineageLoader.createThreadLineageAtomFamily(connectionAtomRuntime, {
  refreshTrigger: ({ environmentId, input }) =>
    lineageChangeAtom(scopedThreadKey(scopeThreadRef(environmentId, input))),
});

/**
 * The viewed thread's lineage, laid out; "loading" until the first fetch lands, null when it
 * failed. A refetch keeps the drawing until it lands, and the layout only changes when the
 * lineage or what a family thread is doing does.
 */
const lineageAtom = Atom.family((key: string) => {
  const ref = parseScopedThreadKey(key);
  let drawn: {
    readonly lineage: OrchestrationV2ThreadLineage;
    readonly activity: string;
    readonly layout: LineageLayout | null;
  } | null = null;
  return Atom.make((get): LineageLayout | null | "loading" => {
    if (ref === null) return null;
    const result = get(lineageQueryAtom({ environmentId: ref.environmentId, input: ref.threadId }));
    const lineage = Option.getOrNull(AsyncResult.value(result));
    if (lineage === null) return result._tag === "Failure" ? null : "loading";
    const activity = threadActivity(
      lineage,
      get(environmentThreadShells.environmentThreadIndexAtom(ref.environmentId)),
    );
    const activityKey = [...activity].join("\n");
    if (drawn?.lineage === lineage && drawn.activity === activityKey) return drawn.layout;
    const layout = lineageLayout(lineageInput(lineage, ref.threadId, activity));
    drawn = { lineage, activity: activityKey, layout };
    return layout;
  }).pipe(Atom.withLabel(`web-lineage:${key}`));
});

// The drawing's measures, in px.
const COLUMN = 110;
const LANE = 56;
/** Under lane 0, the viewed thread's checkpoint labels. */
const BAND = 52;
const PAD_X = 64;
/** A root's line starts this far before its first checkpoint. */
const LEAD = 40;
/** How far along a fork's switch runs before it is level with its lane. */
const SWITCH = 0.7 * COLUMN;
const MERGE_SWITCH = 1.25 * COLUMN;
const DOT = 5.5;
const RING = 10;
const STROKE = 1.75;

// Drawn once, as the first lineage arrives: the viewed thread's line, then the others, then what
// came back.
const EASE = "cubic-bezier(0.3, 0, 0.2, 1)";
const drawStyle = (drawn: boolean, delay: number): CSSProperties => ({
  strokeDasharray: "1 2",
  strokeDashoffset: drawn ? 0 : 1,
  transition: `stroke-dashoffset 600ms ${EASE} ${delay}ms`,
});
const fadeStyle = (drawn: boolean, delay: number): CSSProperties => ({
  opacity: drawn ? 1 : 0,
  transition: `opacity 300ms ease ${delay}ms`,
});

/**
 * The viewed thread's fork family as a railway diagram, left to right: solid lines carry history
 * verbatim, dotted ones a fork's context summarized back. Quiet stretches fold into a count. A
 * checkpoint on the viewed thread scrolls the chat to its turn; anything of another thread opens
 * that thread in a chat tab.
 */
export default function LineagePanel({
  threadRef,
  onShowTurn,
}: {
  readonly threadRef: ScopedThreadRef;
  /** Scrolls the chat to a turn, given its user message id. */
  readonly onShowTurn: (messageId: string) => void;
}) {
  const threadKey = scopedThreadKey(threadRef);
  const lineage = useAtomValue(lineageAtom(threadKey));
  const [unfolded, setUnfolded] = useState<ReadonlySet<string> | "all">(() => new Set());
  const layout: FoldedLineageLayout | null =
    lineage === "loading" || lineage === null ? null : foldLineage(lineage, unfolded);
  // Relative times move on with the clock.
  const now = Date.parse(`${useNowMinute()}Z`);
  const reading = useReadingTurn(threadKey);
  const readingPoint =
    reading === null
      ? undefined
      : (layout?.points.find((point) => point.lane === 0 && point.turn?.messageId === reading) ??
        layout?.points.find((point) => point.turn?.messageId === reading));
  const readingFold =
    reading === null || readingPoint !== undefined
      ? undefined
      : layout?.folds.find((fold) => fold.messageIds.has(reading));
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(threadRef.environmentId));
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const [drawn, setDrawn] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const ready = layout !== null;
  useEffect(() => {
    if (drawn || !ready) return;
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [drawn, ready]);

  const minLane = layout?.minLane ?? 0;
  const top = minLane < 0 ? 52 : 28;
  const x = (column: number) => PAD_X + column * COLUMN;
  const y = (lane: number) => top + (lane - minLane) * LANE + (lane > 0 ? BAND : 0);

  // Opens on the turn the chat shows (else "you are here") at the drawing's right end, and keeps
  // it there as the lineage loads and grows, until the person scrolls or clicks. After that a new
  // turn read in the chat is brought into view, if it is out of it.
  const focus =
    readingPoint ??
    (readingFold === undefined
      ? layout?.here
      : { column: readingFold.column, lane: readingFold.lanes[0]?.lane ?? 0 });
  const focusKey = readingPoint !== undefined || readingFold !== undefined ? reading : "here";
  const followed = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || focus === undefined) return;
    const at = x(focus.column);
    if (!touched.current) {
      followed.current = focusKey;
      element.scrollLeft = Math.max(0, at + PAD_X - element.clientWidth);
      element.scrollTop = Math.max(0, y(0) - element.clientHeight / 2);
      return;
    }
    if (followed.current === focusKey) return;
    followed.current = focusKey;
    if (at < element.scrollLeft + PAD_X || at > element.scrollLeft + element.clientWidth - PAD_X) {
      element.scrollLeft = Math.max(0, at - element.clientWidth / 2);
    }
  });
  const touch = () => {
    touched.current = true;
  };

  // The minimap shows only when the drawing is wider than the panel, and stands in for its
  // scrollbars. Measured against the box with any scrollbar in it, so hiding them cannot tip it.
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = scroller.current;
    if (!ready || !element) return;
    const measure = () => setOverflows(element.scrollWidth > element.offsetWidth + 1);
    measure();
    // The panel, and the drawing as it unfolds or grows.
    const stops = [element, element.firstElementChild].flatMap((each) =>
      each === null ? [] : [observeResize(each, measure)],
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [ready]);
  const scrollToFraction = (across: number, down: number) => {
    const element = scroller.current;
    if (!element) return;
    touch();
    element.scrollLeft = minimapScroll(across, element.scrollWidth, element.clientWidth);
    element.scrollTop = minimapScroll(down, element.scrollHeight, element.clientHeight);
  };

  if (lineage === "loading") return null;
  if (layout === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Lineage isn't available for this thread.
      </div>
    );
  }

  const width = x(layout.columns - 1) + PAD_X;
  const height = y(layout.maxLane) + (layout.maxLane > 0 ? 52 : BAND);
  const viewedId = threadRef.threadId;
  const titleOf = new Map(layout.labels.map((label) => [label.threadId, label.title]));
  const pointKey = (point: LineagePoint) =>
    `${point.threadId}:${point.turn?.runId ?? `end:${point.column}`}`;
  const agentName = (instanceId: string) => {
    const provider = providers.find((entry) => entry.instanceId === instanceId);
    if (provider !== undefined) return resolveProviderInstanceDisplayName(provider);
    return isProviderDriverKind(instanceId)
      ? formatProviderDriverKindLabel(instanceId)
      : instanceId;
  };
  const openThread = (threadId: string) => {
    const ref = scopeThreadRef(threadRef.environmentId, ThreadId.make(threadId));
    useChatTabsStore.getState().openNew(scopedThreadKey(ref));
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  const lineFrom = (line: LineageLayout["lines"][number]) => {
    const end = x(line.end);
    const lane = y(line.lane);
    if (line.fork === null) return `M ${x(line.start) - LEAD} ${lane} H ${end}`;
    const fromX = x(line.fork.column);
    const fromY = y(line.fork.lane);
    const bend = fromX + SWITCH / 2;
    return `M ${fromX} ${fromY} C ${bend} ${fromY} ${bend} ${lane} ${fromX + SWITCH} ${lane} H ${end}`;
  };
  const mergeBackFrom = (curve: LineageLayout["mergeBacks"][number]) => {
    const fromX = x(curve.from.column);
    const fromY = y(curve.from.lane);
    const toX = x(curve.to.column);
    const toY = y(curve.to.lane);
    // Along the fork's lane, then a switch onto the turn; or, mid-fork, one switch the whole way.
    const run = curve.alongLane ? Math.min(MERGE_SWITCH, toX - fromX) : toX - fromX;
    const bend = toX - run / 2;
    return `M ${fromX} ${fromY} H ${toX - run} C ${bend} ${fromY} ${bend} ${toY} ${toX} ${toY}`;
  };

  const unfold = (key: string) =>
    setUnfolded((current) => (current === "all" ? current : new Set([...current, key])));

  const minimapDots: MinimapDot[] = [
    ...(readingPoint !== undefined && readingPoint.mark !== "here"
      ? [
          {
            key: "reading",
            x: x(readingPoint.column),
            y: y(readingPoint.lane),
            kind: "reading" as const,
          },
        ]
      : readingFold !== undefined
        ? [
            {
              key: "reading",
              x: x(readingFold.column),
              y: y(readingFold.lanes[0]?.lane ?? 0),
              kind: "reading" as const,
            },
          ]
        : []),
    ...layout.points.flatMap((point): MinimapDot[] =>
      point.mark === null
        ? []
        : [
            {
              key: pointKey(point),
              x: x(point.column),
              y: y(point.lane),
              kind: point.mark === "here" ? "here" : point.lane === 0 ? "viewed" : "turn",
            },
          ],
    ),
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <TooltipScrollDismissArea
        ref={scroller}
        className={cn(
          "min-h-0 w-full flex-1 overflow-auto overscroll-contain",
          overflows && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        onWheel={touch}
        onPointerDown={touch}
        onKeyDown={touch}
      >
        <div className="flex min-h-full w-max min-w-full items-center justify-center">
          <section
            aria-label="Thread lineage"
            className="relative shrink-0"
            style={{ width, height }}
          >
            <svg
              aria-hidden
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              className="pointer-events-none absolute inset-0 overflow-visible"
            >
              {layout.lines.map((line) => {
                const viewed = line.threadId === viewedId;
                const d = lineFrom(line);
                return (
                  <g key={line.threadId}>
                    <path
                      d={d}
                      pathLength={1}
                      fill="none"
                      className="stroke-foreground"
                      strokeWidth={STROKE}
                      strokeLinecap="round"
                      style={drawStyle(drawn, viewed ? 0 : 300)}
                    />
                    {viewed ? null : (
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        className="pointer-events-auto cursor-pointer"
                        strokeWidth={14}
                        onClick={() => openThread(line.threadId)}
                      />
                    )}
                  </g>
                );
              })}
              {layout.mergeBacks.map((curve) => (
                <path
                  key={`${curve.sourceThreadId}:${curve.from.column}`}
                  d={mergeBackFrom(curve)}
                  fill="none"
                  className="stroke-foreground"
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray="2 7"
                  style={fadeStyle(drawn, 800)}
                />
              ))}
              {readingPoint !== undefined && readingPoint.mark !== "here" ? (
                // The turn the chat shows.
                <circle
                  cx={x(readingPoint.column)}
                  cy={y(readingPoint.lane)}
                  r={RING + 3}
                  className="fill-foreground/12"
                />
              ) : null}
              {layout.points.map((point) => (
                <Mark
                  key={pointKey(point)}
                  point={point}
                  cx={x(point.column)}
                  cy={y(point.lane)}
                  style={point.threadId === viewedId ? undefined : fadeStyle(drawn, 600)}
                />
              ))}
            </svg>
            {layout.labels.map((label) => {
              const left = label.afterSwitch ? x(label.column) + SWITCH : x(label.column) - LEAD;
              const detail = `${agentName(label.providerInstanceId)} · ${labelStatus(label, now)}`;
              return (
                <Tooltip key={label.threadId}>
                  <TooltipTrigger
                    delay={300}
                    render={
                      <button
                        type="button"
                        aria-label={`Open ${label.title} in a new tab`}
                        onClick={() => openThread(label.threadId)}
                        className="absolute flex cursor-pointer flex-col items-start rounded-sm px-1 text-left text-xs leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        style={{
                          left: left - 4,
                          top: label.side === "above" ? y(label.lane) - 44 : y(label.lane) + 10,
                          maxWidth: Math.max(
                            COLUMN,
                            Math.min(
                              label.room * COLUMN - (left - x(label.column)) - 8,
                              width - left - 4,
                            ),
                          ),
                          ...fadeStyle(drawn, 600),
                        }}
                      />
                    }
                  >
                    <span className="max-w-full truncate text-foreground">{label.title}</span>
                    <span className="max-w-full truncate text-muted-foreground tabular-nums">
                      {detail}
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    <span className="block font-medium">{label.title}</span>
                    <span className="block text-muted-foreground">{detail}</span>
                    {label.additions + label.deletions > 0 ? (
                      <span className="block text-muted-foreground tabular-nums">
                        {lineTotals(label.additions, label.deletions)} across its turns
                      </span>
                    ) : null}
                    {label.behind > 0 ? (
                      <span className="block text-muted-foreground">
                        Its parent has taken {label.behind} {label.behind === 1 ? "turn" : "turns"}{" "}
                        since it forked
                      </span>
                    ) : null}
                  </TooltipPopup>
                </Tooltip>
              );
            })}
            {layout.folds.flatMap((fold) =>
              fold.lanes.map(({ lane, turns }) => (
                <button
                  key={`${fold.key}:${lane}`}
                  type="button"
                  aria-label={`Show ${turns} folded ${turns === 1 ? "turn" : "turns"}`}
                  onClick={() => unfold(fold.key)}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border bg-background px-1.5 text-2xs leading-4 tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    fold === readingFold
                      ? "border-foreground text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                  style={{ left: x(fold.column), top: y(lane), ...fadeStyle(drawn, 600) }}
                >
                  {turns} {turns === 1 ? "turn" : "turns"}
                </button>
              )),
            )}
            {layout.points.map((point) => {
              const cx = x(point.column);
              const cy = y(point.lane);
              const viewed = point.threadId === viewedId;
              const here = point.mark === "here";
              const text = point.labelled ? (
                <span className="flex w-full flex-col items-center text-center text-xs leading-4">
                  <span
                    className={
                      here
                        ? "w-full truncate text-foreground"
                        : "line-clamp-2 w-full wrap-anywhere text-foreground"
                    }
                  >
                    {point.turn?.label}
                  </span>
                  {here ? <span className="text-muted-foreground">You are here</span> : null}
                </span>
              ) : null;
              if (point.turn === null) {
                // A line's end without a turn: only the viewed thread's says anything.
                return here ? (
                  <span
                    key={pointKey(point)}
                    className="absolute -translate-x-1/2 text-xs leading-4 text-muted-foreground"
                    style={{ left: cx, top: cy + 14 }}
                  >
                    You are here
                  </span>
                ) : null;
              }
              const turn = point.turn;
              const messageId = turn.messageId;
              const reply = replyLine(turn.reply);
              const open = !viewed
                ? () => openThread(point.threadId)
                : messageId === null
                  ? null
                  : () => onShowTurn(messageId);
              return (
                <Tooltip key={pointKey(point)}>
                  <TooltipTrigger
                    delay={200}
                    render={
                      <button
                        type="button"
                        disabled={open === null}
                        aria-label={
                          viewed
                            ? `Show the turn "${turn.label}" in the chat`
                            : `Open ${titleOf.get(point.threadId) ?? "this thread"} in a new tab`
                        }
                        onClick={open ?? undefined}
                        className="absolute flex -translate-x-1/2 cursor-pointer flex-col items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default"
                        style={{
                          left: cx,
                          top: cy - 12,
                          width: text === null ? 24 : COLUMN - 16,
                          ...(viewed ? {} : fadeStyle(drawn, 600)),
                        }}
                      />
                    }
                  >
                    <span aria-hidden className="h-6 w-6 shrink-0" />
                    {text}
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    <span className="flex max-w-80 flex-col gap-1">
                      <span className="line-clamp-3 font-medium">{turn.label}</span>
                      {reply === null ? null : (
                        <span className="line-clamp-3 text-muted-foreground">{reply}</span>
                      )}
                      <span className="text-muted-foreground tabular-nums">
                        {turnFacts(turn, now)}
                      </span>
                    </span>
                  </TooltipPopup>
                </Tooltip>
              );
            })}
          </section>
        </div>
      </TooltipScrollDismissArea>
      {layout.foldable > 0 || overflows ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-2 py-1.5">
          {layout.foldable > 0 ? (
            <Button
              size="compact"
              variant="outline"
              onClick={() => setUnfolded(layout.folds.length > 0 ? "all" : new Set())}
            >
              {layout.folds.length > 0 ? "Show every turn" : "Fold quiet turns"}
            </Button>
          ) : null}
          {overflows ? (
            <LineageMinimap
              width={width}
              height={height}
              paths={[
                ...layout.lines.map((line) => ({
                  key: line.threadId,
                  d: lineFrom(line),
                  viewed: line.threadId === viewedId,
                  dashed: false,
                })),
                ...layout.mergeBacks.map((curve) => ({
                  key: `merge:${curve.sourceThreadId}:${curve.from.column}`,
                  d: mergeBackFrom(curve),
                  viewed: false,
                  dashed: true,
                })),
              ]}
              dots={minimapDots}
              scroller={scroller}
              onNavigate={scrollToFraction}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One point's mark, in the one ink: filled, hollow while its turn runs, or the ring of "here". */
function Mark({
  point,
  cx,
  cy,
  style,
}: {
  readonly point: LineagePoint;
  readonly cx: number;
  readonly cy: number;
  readonly style: CSSProperties | undefined;
}) {
  switch (point.mark) {
    case "checkpoint":
      return <circle cx={cx} cy={cy} r={DOT} className="fill-foreground" style={style} />;
    case "running":
      return (
        <circle
          cx={cx}
          cy={cy}
          r={DOT}
          className="fill-background stroke-foreground"
          strokeWidth={STROKE}
          style={style}
        />
      );
    case "here":
      return (
        <g style={style}>
          <circle
            cx={cx}
            cy={cy}
            r={RING}
            className="fill-background stroke-foreground"
            strokeWidth={STROKE}
          />
          <circle cx={cx} cy={cy} r={DOT - 1} className="fill-foreground" />
        </g>
      );
    case null:
      return null;
  }
}
