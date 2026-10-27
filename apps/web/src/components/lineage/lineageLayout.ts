/**
 * Lays out a fork family in columns and lanes. Each checkpoint takes its own column in the order
 * turns were asked, so a fork's turns sit between its parent's and a merge-back lands on the turn
 * that took it. The viewed thread is lane 0 (negative lanes above); its forks alternate sides and
 * others' keep moving away, each on the nearest lane free for the columns it spans.
 */

/** One turn of a thread, as the lineage draws it. */
export interface LineageTurn {
  readonly runId: string;
  /** The run's user message: the chat row its checkpoint scrolls to. */
  readonly messageId: string | null;
  /** When the turn was asked, in epoch milliseconds. */
  readonly at: number;
  readonly running: boolean;
  /** The first line of what was asked, in full. */
  readonly label: string;
  /** When the turn ended, in epoch milliseconds; null while it runs. */
  readonly completedAt: number | null;
  readonly model: string | null;
  /** The start of the agent's last message in the turn; empty when it has none. */
  readonly reply: string;
  readonly additions: number;
  readonly deletions: number;
  readonly files: number;
}

/** What a thread is doing now: working, or waiting on the person (a question, an approval, a plan). */
export type LineageActivity = "running" | "waiting";

export interface LineageThread {
  readonly id: string;
  readonly title: string;
  /** The thread this one forked from; null for the family's root. */
  readonly parentId: string | null;
  /** The parent's run the fork left from, when known. */
  readonly forkRunId: string | null;
  readonly createdAt: number;
  readonly providerInstanceId: string;
  /** Null when it is doing nothing. */
  readonly activity: LineageActivity | null;
  /** In order, without rolled-back runs. */
  readonly turns: ReadonlyArray<LineageTurn>;
}

/** A fork's context carried back into its parent, which arrives summarized. */
export interface LineageMergeBack {
  readonly id: string;
  readonly sourceThreadId: string;
  readonly sourceRunId: string | null;
  readonly targetThreadId: string;
  /** The target's run that took the context; null while it waits for one. */
  readonly targetRunId: string | null;
  readonly at: number;
}

export interface LineageInput {
  readonly viewedThreadId: string;
  readonly threads: ReadonlyArray<LineageThread>;
  readonly mergeBacks: ReadonlyArray<LineageMergeBack>;
}

export interface LineageSpot {
  readonly column: number;
  readonly lane: number;
}

/**
 * Filled: a checkpoint, or the end of a fork that has asked nothing yet, which stands on the
 * checkpoint it forked from. Hollow: a turn still running. Ring: the viewed thread's latest point.
 */
export type LineageMark = "checkpoint" | "running" | "here";

export interface LineagePoint extends LineageSpot {
  readonly threadId: string;
  /** The turn this point closes; null where a line ends without one, or a merge-back waits. */
  readonly turn: LineageTurn | null;
  readonly mark: LineageMark | null;
  /** The turn's label is drawn under it: the viewed thread's points, except where a fork leaves downward. */
  readonly labelled: boolean;
}

export interface LineageLine {
  readonly threadId: string;
  readonly lane: number;
  /** Where the line leaves its parent's lane; null for the family's root. */
  readonly fork: LineageSpot | null;
  /** The columns the line spans on its own lane, its fork column included. */
  readonly start: number;
  readonly end: number;
}

export interface LineageMergeBackCurve {
  readonly sourceThreadId: string;
  readonly from: LineageSpot;
  readonly to: LineageSpot;
  /** No turn has taken the context yet: the curve ends where the next one will. */
  readonly pending: boolean;
  /** It leaves the fork's last point, so it runs along the fork's lane before it turns. */
  readonly alongLane: boolean;
}

/** Where a thread stands, as its label says it, the first that applies. */
export type LineageState = LineageActivity | "merged back" | "not started" | "idle";

/**
 * A thread's title, near the start of its line, on the side away from the viewed thread. It never
 * sits where one of the thread's forks switches off its lane toward that side.
 */
export interface LineageLabel extends LineageSpot {
  readonly threadId: string;
  readonly title: string;
  readonly providerInstanceId: string;
  readonly state: LineageState;
  /** When the thread last moved, in epoch milliseconds: its latest turn's end, else its start. */
  readonly lastActiveAt: number;
  /** Turns its parent has taken since it forked; 0 for a root. */
  readonly behind: number;
  /** The thread's line totals across its turns. */
  readonly additions: number;
  readonly deletions: number;
  readonly side: "above" | "below";
  /**
   * The label starts a switch's run past `column`, clear of the switch leaving there: the
   * thread's own fork, or a fork of the thread's that leaves toward the label.
   */
  readonly afterSwitch: boolean;
  /** Columns of free lane from `column` on, before the next line or switch, for the label. */
  readonly room: number;
}

export interface LineageLayout {
  readonly columns: number;
  readonly minLane: number;
  readonly maxLane: number;
  readonly lines: ReadonlyArray<LineageLine>;
  readonly points: ReadonlyArray<LineagePoint>;
  readonly mergeBacks: ReadonlyArray<LineageMergeBackCurve>;
  readonly labels: ReadonlyArray<LineageLabel>;
  readonly here: LineageSpot;
}

/** Columns a thread label claims on its lane, so the next thread there does not run into it. */
const LABEL_COLUMNS = 2;

interface Slot {
  readonly threadId: string;
  readonly turn: LineageTurn | null;
  at: number;
  readonly order: number;
  column: number;
}

export function lineageLayout(input: LineageInput): LineageLayout | null {
  const byId = new Map(input.threads.map((thread) => [thread.id, thread]));
  const viewed = byId.get(input.viewedThreadId);
  if (viewed === undefined) return null;
  const parentOf = (thread: LineageThread) =>
    thread.parentId === null ? undefined : byId.get(thread.parentId);

  // Parents before children, siblings oldest first, the viewed thread's root first.
  const forks = new Map<string, LineageThread[]>();
  const roots: LineageThread[] = [];
  for (const thread of input.threads) {
    const parent = parentOf(thread);
    if (parent === undefined) roots.push(thread);
    else forks.set(parent.id, [...(forks.get(parent.id) ?? []), thread]);
  }
  const climbed = new Set([viewed]);
  let viewedRoot = viewed;
  for (let parent = parentOf(viewed); parent && !climbed.has(parent); parent = parentOf(parent)) {
    climbed.add(parent);
    viewedRoot = parent;
  }
  const byAge = (left: LineageThread, right: LineageThread) =>
    left.createdAt - right.createdAt || left.id.localeCompare(right.id);
  const ordered = [viewedRoot, ...roots.filter((root) => root !== viewedRoot).toSorted(byAge)];
  const listed = new Set(ordered);
  for (let index = 0; index < ordered.length; index += 1) {
    for (const child of (forks.get(ordered[index]!.id) ?? []).toSorted(byAge)) {
      if (listed.has(child)) continue;
      listed.add(child);
      ordered.push(child);
    }
  }

  // A slot per turn (or one line end for a thread without turns), never before what it follows.
  const slots: Slot[] = [];
  const slotsOf = new Map<string, Slot[]>();
  const forkSlotOf = new Map<string, Slot>();
  let order = 0;
  for (const thread of ordered) {
    const parentSlots = thread.parentId === null ? undefined : slotsOf.get(thread.parentId);
    const from =
      parentSlots === undefined
        ? undefined
        : (parentSlots.find((slot) => slot.turn !== null && slot.turn.runId === thread.forkRunId) ??
          parentSlots.findLast((slot) => slot.at <= thread.createdAt) ??
          parentSlots[0]);
    if (from !== undefined) forkSlotOf.set(thread.id, from);
    let at = from?.at ?? Number.NEGATIVE_INFINITY;
    const own: Slot[] = thread.turns.map((turn) => {
      at = Math.max(at, turn.at);
      return { threadId: thread.id, turn, at, order: (order += 1), column: 0 };
    });
    if (own.length === 0) {
      own.push({
        threadId: thread.id,
        turn: null,
        at: Math.max(at, thread.createdAt),
        order: (order += 1),
        column: 0,
      });
    }
    slotsOf.set(thread.id, own);
    slots.push(...own);
  }

  // A merge-back no turn has taken yet lands after the target's last point, one landing per target.
  const landings = new Map<string, Slot>();
  const curves: Array<{
    readonly mergeBack: LineageMergeBack;
    readonly source: Slot;
    readonly target: Slot;
    readonly pending: boolean;
  }> = [];
  for (const mergeBack of input.mergeBacks) {
    const sourceSlots = slotsOf.get(mergeBack.sourceThreadId);
    const targetSlots = slotsOf.get(mergeBack.targetThreadId);
    if (sourceSlots === undefined || targetSlots === undefined) continue;
    const source =
      sourceSlots.find((slot) => slot.turn !== null && slot.turn.runId === mergeBack.sourceRunId) ??
      sourceSlots.at(-1)!;
    const taken =
      mergeBack.targetRunId === null
        ? undefined
        : targetSlots.find(
            (slot) => slot.turn !== null && slot.turn.runId === mergeBack.targetRunId,
          );
    if (taken !== undefined) {
      curves.push({ mergeBack, source, target: taken, pending: false });
      continue;
    }
    const after = Math.max(mergeBack.at, source.at, targetSlots.at(-1)!.at);
    let landing = landings.get(mergeBack.targetThreadId);
    if (landing === undefined) {
      landing = {
        threadId: mergeBack.targetThreadId,
        turn: null,
        at: after,
        order: Number.MAX_SAFE_INTEGER - landings.size,
        column: 0,
      };
      landings.set(mergeBack.targetThreadId, landing);
      slots.push(landing);
    } else {
      landing.at = Math.max(landing.at, after);
    }
    curves.push({ mergeBack, source, target: landing, pending: true });
  }

  slots.sort((left, right) => left.at - right.at || left.order - right.order);
  slots.forEach((slot, column) => {
    slot.column = column;
  });

  const startOf = (thread: LineageThread) =>
    (forkSlotOf.get(thread.id) ?? slotsOf.get(thread.id)![0]!).column;
  const endOf = (thread: LineageThread) => slotsOf.get(thread.id)!.at(-1)!.column;
  const alongLane = (curve: (typeof curves)[number]) =>
    curve.source === slotsOf.get(curve.mergeBack.sourceThreadId)!.at(-1);

  // What a thread holds of its lane: its line, its label's room, and a merge-back running along it.
  const spanOf = (thread: LineageThread): readonly [number, number] => {
    const start = startOf(thread);
    let end = endOf(thread);
    if (thread !== viewed) end = Math.max(end, start + LABEL_COLUMNS);
    for (const curve of curves) {
      if (curve.mergeBack.sourceThreadId === thread.id && alongLane(curve)) {
        end = Math.max(end, curve.target.column);
      }
    }
    return [start, end];
  };

  const laneOf = new Map<string, number>();
  const held = new Map<number, Array<readonly [number, number]>>();
  const take = (thread: LineageThread, lane: number) => {
    laneOf.set(thread.id, lane);
    held.set(lane, [...(held.get(lane) ?? []), spanOf(thread)]);
  };
  const isFree = (lane: number, [start, end]: readonly [number, number]) =>
    lane !== 0 &&
    (held.get(lane) ?? []).every(([heldStart, heldEnd]) => end < heldStart || heldEnd < start);
  const place = (thread: LineageThread, anchor: number, toward: -1 | 1) => {
    const span = spanOf(thread);
    const sides = anchor === 0 ? [toward, -toward] : [Math.sign(anchor)];
    for (let distance = 1; ; distance += 1) {
      for (const side of sides) {
        const lane = anchor + distance * side;
        if (isFree(lane, span)) return take(thread, lane);
      }
    }
  };

  take(viewed, 0);
  // The threads the viewed one came from, each above the one that forked from it.
  let below = viewed;
  for (let parent = parentOf(viewed); parent && !laneOf.has(parent.id); parent = parentOf(parent)) {
    place(parent, laneOf.get(below.id)!, -1);
    below = parent;
  }
  const forksPlaced = new Map<string, number>();
  for (const thread of ordered) {
    if (laneOf.has(thread.id)) continue;
    const parent = parentOf(thread);
    if (parent === undefined) {
      place(thread, 0, -1);
      continue;
    }
    const count = forksPlaced.get(parent.id) ?? 0;
    forksPlaced.set(parent.id, count + 1);
    place(thread, laneOf.get(parent.id)!, count % 2 === 0 ? -1 : 1);
  }

  const lanes = [...laneOf.values()];
  const mergedBack = new Set(input.mergeBacks.map((mergeBack) => mergeBack.sourceThreadId));
  const leavesDownward = new Set<Slot>();
  for (const thread of ordered) {
    const from = forkSlotOf.get(thread.id);
    if (from !== undefined && laneOf.get(thread.id)! > laneOf.get(from.threadId)!) {
      leavesDownward.add(from);
    }
  }
  const viewedEnd = slotsOf.get(viewed.id)!.at(-1)!;
  const landed = new Set(landings.values());

  return {
    columns: slots.length,
    minLane: Math.min(...lanes),
    maxLane: Math.max(...lanes),
    lines: ordered.map((thread) => {
      const fork = forkSlotOf.get(thread.id);
      return {
        threadId: thread.id,
        lane: laneOf.get(thread.id)!,
        fork: fork === undefined ? null : { column: fork.column, lane: laneOf.get(fork.threadId)! },
        start: startOf(thread),
        end: endOf(thread),
      };
    }),
    points: slots.map((slot) => {
      const isHere = slot === viewedEnd;
      return {
        threadId: slot.threadId,
        turn: slot.turn,
        column: slot.column,
        lane: laneOf.get(slot.threadId)!,
        mark: isHere
          ? "here"
          : slot.turn === null
            ? landed.has(slot)
              ? null
              : "checkpoint"
            : slot.turn.running
              ? "running"
              : "checkpoint",
        labelled:
          isHere ||
          (slot.threadId === viewed.id && slot.turn !== null && !leavesDownward.has(slot)),
      };
    }),
    mergeBacks: curves.map((curve) => ({
      sourceThreadId: curve.mergeBack.sourceThreadId,
      from: { column: curve.source.column, lane: laneOf.get(curve.source.threadId)! },
      to: { column: curve.target.column, lane: laneOf.get(curve.target.threadId)! },
      pending: curve.pending,
      alongLane: alongLane(curve),
    })),
    labels: ordered.flatMap((thread) => {
      if (thread === viewed) return [];
      const lane = laneOf.get(thread.id)!;
      const side = lane < 0 ? ("above" as const) : ("below" as const);
      // Where the thread's own forks switch off its lane through the label's side.
      const switches = ordered
        .flatMap((child) => {
          const from = forkSlotOf.get(child.id);
          if (from?.threadId !== thread.id) return [];
          const childLane = laneOf.get(child.id)!;
          return (side === "above" ? childLane < lane : childLane > lane) ? [from.column] : [];
        })
        .toSorted((left, right) => left - right);
      let column = startOf(thread);
      let afterSwitch = forkSlotOf.has(thread.id);
      for (;;) {
        const within = switches.filter(
          (switchColumn) =>
            (afterSwitch ? switchColumn > column : switchColumn >= column) &&
            switchColumn < column + LABEL_COLUMNS,
        );
        if (within.length === 0) break;
        column = within.at(-1)!;
        afterSwitch = true;
      }
      const next = Math.min(
        ...(held.get(lane) ?? []).flatMap(([heldStart]) => (heldStart > column ? [heldStart] : [])),
        ...switches.filter((switchColumn) => switchColumn > column),
      );
      const from = forkSlotOf.get(thread.id);
      const last = thread.turns.at(-1);
      return [
        {
          threadId: thread.id,
          title: thread.title,
          providerInstanceId: thread.providerInstanceId,
          state:
            thread.activity ??
            (mergedBack.has(thread.id)
              ? "merged back"
              : thread.turns.length === 0
                ? "not started"
                : "idle"),
          lastActiveAt: last === undefined ? thread.createdAt : (last.completedAt ?? last.at),
          behind:
            from === undefined
              ? 0
              : slotsOf
                  .get(from.threadId)!
                  .filter((slot) => slot.turn !== null && slot.column > from.column).length,
          additions: thread.turns.reduce((sum, turn) => sum + turn.additions, 0),
          deletions: thread.turns.reduce((sum, turn) => sum + turn.deletions, 0),
          column,
          lane,
          side,
          afterSwitch,
          room: (Number.isFinite(next) ? next : slots.length) - column,
        },
      ];
    }),
    here: { column: viewedEnd.column, lane: 0 },
  };
}

/**
 * A stretch of quiet columns drawn as one: no fork leaves in it, no merge-back lands or leaves,
 * no line starts or ends, and none of the viewed thread's latest turns are in it.
 */
export interface LineageFold {
  /** Stable while the stretch grows: its first turn's run. */
  readonly key: string;
  readonly column: number;
  /** The turns it holds, by lane. */
  readonly lanes: ReadonlyArray<{ readonly lane: number; readonly turns: number }>;
  /** Its turns' user messages, so a turn read in the chat can find its fold. */
  readonly messageIds: ReadonlySet<string>;
}

export interface FoldedLineageLayout extends LineageLayout {
  readonly folds: ReadonlyArray<LineageFold>;
  /** How many stretches could fold, folded or not. */
  readonly foldable: number;
}

/** Shorter quiet stretches stay drawn: a fold takes a column of its own. */
const MIN_FOLD = 3;
/** The viewed thread's latest turns stay drawn. */
const RECENT_TURNS = 3;

/**
 * The layout with its quiet stretches folded, each into one column, except those `unfolded`
 * names (by key), or all of them. Lanes stay as laid out; columns close up.
 */
export function foldLineage(
  layout: LineageLayout,
  unfolded: ReadonlySet<string> | "all",
): FoldedLineageLayout {
  const keep = new Set<number>([layout.here.column]);
  for (const line of layout.lines) {
    keep.add(line.start);
    keep.add(line.end);
    if (line.fork !== null) keep.add(line.fork.column);
  }
  for (const curve of layout.mergeBacks) {
    keep.add(curve.from.column);
    keep.add(curve.to.column);
  }
  for (const point of layout.points) {
    if (point.turn === null || point.mark !== "checkpoint") keep.add(point.column);
  }
  for (const point of layout.points.filter((each) => each.lane === 0).slice(-RECENT_TURNS)) {
    keep.add(point.column);
  }
  // A thread's label keeps the room it was laid out with.
  for (const label of layout.labels) {
    for (let column = label.column; column <= label.column + LABEL_COLUMNS; column += 1) {
      keep.add(column);
    }
  }

  const byColumn = new Map(layout.points.map((point) => [point.column, point]));
  const stretches: Array<{ readonly start: number; readonly end: number; readonly key: string }> =
    [];
  for (let column = 0; column < layout.columns; column += 1) {
    if (keep.has(column)) continue;
    let end = column;
    while (end + 1 < layout.columns && !keep.has(end + 1)) end += 1;
    if (end - column + 1 >= MIN_FOLD) {
      stretches.push({ start: column, end, key: byColumn.get(column)?.turn?.runId ?? `${column}` });
    }
    column = end;
  }
  const folded = stretches.filter((stretch) => unfolded !== "all" && !unfolded.has(stretch.key));

  // Each column's place once folded; one past the last for a label's room to the end.
  const at: number[] = [];
  let next = 0;
  let stretch = 0;
  for (let column = 0; column < layout.columns; column += 1) {
    const current = folded[stretch];
    if (current !== undefined && column >= current.start && column <= current.end) {
      at.push(column === current.start ? next++ : next - 1);
      if (column === current.end) stretch += 1;
      continue;
    }
    at.push(next++);
  }
  at.push(next);
  const place = (column: number) => at[Math.min(column, layout.columns)]!;
  const isFolded = (column: number) =>
    folded.some((each) => column >= each.start && column <= each.end);

  return {
    ...layout,
    columns: next,
    lines: layout.lines.map((line) => ({
      ...line,
      fork: line.fork === null ? null : { ...line.fork, column: place(line.fork.column) },
      start: place(line.start),
      end: place(line.end),
    })),
    points: layout.points.flatMap((point) =>
      isFolded(point.column) ? [] : [{ ...point, column: place(point.column) }],
    ),
    mergeBacks: layout.mergeBacks.map((curve) => ({
      ...curve,
      from: { ...curve.from, column: place(curve.from.column) },
      to: { ...curve.to, column: place(curve.to.column) },
    })),
    labels: layout.labels.map((label) => ({
      ...label,
      column: place(label.column),
      room: Math.max(1, place(label.column + label.room) - place(label.column)),
    })),
    here: { ...layout.here, column: place(layout.here.column) },
    folds: folded.map((each) => {
      const points = layout.points.filter(
        (point) => point.column >= each.start && point.column <= each.end,
      );
      const lanes = new Map<number, number>();
      for (const point of points) lanes.set(point.lane, (lanes.get(point.lane) ?? 0) + 1);
      return {
        key: each.key,
        column: place(each.start),
        lanes: [...lanes].map(([lane, turns]) => ({ lane, turns })),
        messageIds: new Set(points.flatMap((point) => point.turn?.messageId ?? [])),
      };
    }),
    foldable: stretches.length,
  };
}
