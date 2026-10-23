import { describe, expect, it } from "vite-plus/test";

import {
  foldLineage,
  lineageLayout,
  type LineageLayout,
  type LineageMergeBack,
  type LineageThread,
  type LineageTurn,
} from "./lineageLayout";

const turn = (runId: string, at: number, extra: Partial<LineageTurn> = {}): LineageTurn => ({
  runId,
  messageId: `message-${runId}`,
  at,
  running: false,
  label: `Asked ${runId}`,
  completedAt: null,
  model: null,
  reply: "",
  additions: 0,
  deletions: 0,
  files: 0,
  ...extra,
});

const thread = (
  id: string,
  turns: ReadonlyArray<LineageTurn>,
  extra: Partial<LineageThread> = {},
): LineageThread => ({
  id,
  title: `Thread ${id}`,
  parentId: null,
  forkRunId: null,
  createdAt: turns[0]?.at ?? 0,
  providerInstanceId: "codex",
  activity: null,
  turns,
  ...extra,
});

const fork = (
  id: string,
  parentId: string,
  forkRunId: string,
  createdAt: number,
  turns: ReadonlyArray<LineageTurn>,
  extra: Partial<LineageThread> = {},
) => thread(id, turns, { parentId, forkRunId, createdAt, ...extra });

const layoutOf = (
  viewedThreadId: string,
  threads: ReadonlyArray<LineageThread>,
  mergeBacks: ReadonlyArray<LineageMergeBack> = [],
): LineageLayout => {
  const layout = lineageLayout({ viewedThreadId, threads, mergeBacks });
  if (layout === null) throw new Error("no layout");
  return layout;
};

const pointOf = (layout: LineageLayout, runId: string) => {
  const point = layout.points.find((candidate) => candidate.turn?.runId === runId);
  if (point === undefined) throw new Error(`no point for ${runId}`);
  return point;
};
const laneOf = (layout: LineageLayout, threadId: string) =>
  layout.lines.find((line) => line.threadId === threadId)?.lane;
const labelOf = (layout: LineageLayout, threadId: string) =>
  layout.labels.find((label) => label.threadId === threadId);

describe("lineageLayout", () => {
  it("draws a thread alone as its checkpoints in order, ending where you are", () => {
    const layout = layoutOf("main", [
      thread("main", [turn("m1", 1), turn("m2", 2), turn("m3", 3)]),
    ]);

    expect(layout.columns).toBe(3);
    expect(layout.points.map(({ column, lane, mark }) => ({ column, lane, mark }))).toEqual([
      { column: 0, lane: 0, mark: "checkpoint" },
      { column: 1, lane: 0, mark: "checkpoint" },
      { column: 2, lane: 0, mark: "here" },
    ]);
    expect(layout.points.every((point) => point.labelled)).toBe(true);
    expect(layout.lines).toEqual([{ threadId: "main", lane: 0, fork: null, start: 0, end: 2 }]);
    expect(layout.labels).toEqual([]);
    expect(layout.here).toEqual({ column: 2, lane: 0 });
  });

  it("sends two forks from one checkpoint to either side, their turns in the order they were asked", () => {
    const layout = layoutOf("main", [
      thread("main", [turn("m1", 1), turn("m2", 2), turn("m3", 3), turn("m4", 10)]),
      fork("up", "main", "m2", 2.5, [turn("u1", 4), turn("u2", 6)]),
      fork("down", "main", "m2", 2.6, [turn("d1", 5)]),
    ]);

    expect(laneOf(layout, "up")).toBe(-1);
    expect(laneOf(layout, "down")).toBe(1);
    for (const runId of ["m1", "m2", "m3", "u1", "d1", "u2", "m4"]) {
      expect(pointOf(layout, runId).column).toBe(
        ["m1", "m2", "m3", "u1", "d1", "u2", "m4"].indexOf(runId),
      );
    }
    const forkSpot = { column: pointOf(layout, "m2").column, lane: 0 };
    expect(layout.lines.find((line) => line.threadId === "up")?.fork).toEqual(forkSpot);
    expect(layout.lines.find((line) => line.threadId === "down")?.fork).toEqual(forkSpot);
    expect(labelOf(layout, "up")).toMatchObject({ side: "above", column: forkSpot.column });
    expect(labelOf(layout, "down")).toMatchObject({ side: "below", column: forkSpot.column });
    // The downward fork leaves through where its checkpoint's label would sit.
    expect(pointOf(layout, "m2").labelled).toBe(false);
    expect(pointOf(layout, "m3").labelled).toBe(true);
    expect(pointOf(layout, "u1").labelled).toBe(false);
  });

  it("moves a fork of a fork further out from the viewed thread", () => {
    const layout = layoutOf("main", [
      thread("main", [turn("m1", 1), turn("m2", 5)]),
      fork("child", "main", "m1", 1.5, [turn("c1", 2), turn("c2", 4)]),
      fork("grandchild", "child", "c1", 2.5, [turn("g1", 3)]),
    ]);

    expect(laneOf(layout, "child")).toBe(-1);
    expect(laneOf(layout, "grandchild")).toBe(-2);
    expect(layout.lines.find((line) => line.threadId === "grandchild")?.fork).toEqual({
      column: pointOf(layout, "c1").column,
      lane: -1,
    });
  });

  it("puts the thread a viewed fork came from above it, with the fork on lane 0", () => {
    const layout = layoutOf("child", [
      thread("main", [turn("m1", 1), turn("m2", 5)]),
      fork("child", "main", "m1", 1.5, [turn("c1", 2)]),
    ]);

    expect(laneOf(layout, "child")).toBe(0);
    expect(laneOf(layout, "main")).toBe(-1);
    expect(layout.here).toEqual({ column: pointOf(layout, "c1").column, lane: 0 });
    expect(labelOf(layout, "main")).toMatchObject({ side: "above", title: "Thread main" });
    expect(labelOf(layout, "child")).toBeUndefined();
  });

  it("starts a thread's title past a fork switching off its lane through the title", () => {
    // Viewing one fork; its sibling leaves the same parent point upward, through the parent's title.
    const layout = layoutOf("viewed", [
      thread("main", [turn("m1", 1), turn("m2", 10)]),
      fork("viewed", "main", "m1", 1.5, [turn("v1", 2)]),
      fork("sibling", "main", "m1", 1.6, [turn("s1", 3), turn("s2", 4)]),
    ]);

    expect(laneOf(layout, "main")).toBe(-1);
    expect(laneOf(layout, "sibling")).toBe(-2);
    const forkColumn = pointOf(layout, "m1").column;
    expect(layout.lines.find((line) => line.threadId === "sibling")?.fork).toEqual({
      column: forkColumn,
      lane: -1,
    });
    expect(labelOf(layout, "main")).toMatchObject({
      side: "above",
      column: forkColumn,
      afterSwitch: true,
      room: layout.columns - forkColumn,
    });
    // A switch toward the other side, like the viewed fork's, leaves a root's title where it was.
    const alone = layoutOf("viewed", [
      thread("main", [turn("m1", 1), turn("m2", 10)]),
      fork("viewed", "main", "m1", 1.5, [turn("v1", 2)]),
    ]);
    expect(labelOf(alone, "main")).toMatchObject({ column: 0, afterSwitch: false });
  });

  it("stops a title's room at the next fork switching off through it", () => {
    const layout = layoutOf("main", [
      thread("main", [turn("m1", 1), turn("m2", 20)]),
      fork("child", "main", "m1", 1.5, [
        turn("c1", 2),
        turn("c2", 3),
        turn("c3", 4),
        turn("c4", 5),
      ]),
      fork("near", "child", "c1", 2.1, [turn("n1", 2.2)]),
      fork("far", "child", "c4", 5.1, [turn("f1", 6)]),
    ]);

    expect(laneOf(layout, "child")).toBe(-1);
    expect(laneOf(layout, "near")).toBe(-2);
    expect(laneOf(layout, "far")).toBe(-2);
    const c1 = pointOf(layout, "c1").column;
    expect(labelOf(layout, "child")).toMatchObject({
      column: c1,
      afterSwitch: true,
      room: pointOf(layout, "c4").column - c1,
    });
  });

  it("lands a merge-back on the later turn that took it", () => {
    const layout = layoutOf(
      "main",
      [
        thread("main", [turn("m1", 1), turn("m2", 6)]),
        fork("child", "main", "m1", 1.5, [turn("c1", 2), turn("c2", 3)]),
      ],
      [
        {
          id: "transfer",
          sourceThreadId: "child",
          sourceRunId: "c2",
          targetThreadId: "main",
          targetRunId: "m2",
          at: 4,
        },
      ],
    );

    expect(layout.mergeBacks).toEqual([
      {
        sourceThreadId: "child",
        from: { column: pointOf(layout, "c2").column, lane: -1 },
        to: { column: pointOf(layout, "m2").column, lane: 0 },
        pending: false,
        alongLane: true,
      },
    ]);
    expect(pointOf(layout, "m2").column).toBeGreaterThan(pointOf(layout, "c2").column);
    expect(labelOf(layout, "child")?.state).toBe("merged back");
  });

  it("ends a merge-back no turn has taken yet past the parent's last point, without a mark", () => {
    const layout = layoutOf(
      "main",
      [
        thread("main", [turn("m1", 1), turn("m2", 2)]),
        fork("child", "main", "m1", 1.5, [turn("c1", 3)]),
      ],
      [
        {
          id: "transfer",
          sourceThreadId: "child",
          sourceRunId: "c1",
          targetThreadId: "main",
          targetRunId: null,
          at: 4,
        },
      ],
    );

    const [curve] = layout.mergeBacks;
    expect(curve).toMatchObject({ pending: true, to: { column: layout.columns - 1, lane: 0 } });
    expect(layout.points.at(-1)).toMatchObject({ threadId: "main", turn: null, mark: null });
    expect(layout.here).toEqual({ column: pointOf(layout, "m2").column, lane: 0 });
  });

  it("ends a fork that is still working on a hollow point and says so", () => {
    const layout = layoutOf("main", [
      thread("main", [turn("m1", 1), turn("m2", 2)]),
      fork("child", "main", "m1", 1.5, [turn("c1", 3), turn("c2", 4, { running: true })], {
        activity: "running",
      }),
      fork("done", "main", "m2", 2.5, [
        turn("d1", 5, { additions: 12, deletions: 3 }),
        turn("d2", 6, { additions: 2 }),
      ]),
    ]);

    expect(pointOf(layout, "c1").mark).toBe("checkpoint");
    expect(pointOf(layout, "c2").mark).toBe("running");
    expect(labelOf(layout, "child")?.state).toBe("running");
    expect(labelOf(layout, "done")).toMatchObject({ state: "idle", additions: 14, deletions: 3 });
  });

  it("ends a fork that has asked nothing yet on a dot, the same point it is when viewed", () => {
    const threads = [
      thread("main", [turn("m1", 1), turn("m2", 2)]),
      fork("idle", "main", "m1", 1.5, []),
    ];
    const end = (layout: LineageLayout) => layout.points.find((point) => point.threadId === "idle");

    expect(end(layoutOf("main", threads))).toMatchObject({ turn: null, mark: "checkpoint" });
    expect(labelOf(layoutOf("main", threads), "idle")?.state).toBe("not started");
    expect(end(layoutOf("idle", threads))).toMatchObject({ turn: null, mark: "here" });
  });

  it("reuses a lane once the fork before it there has ended", () => {
    const layout = layoutOf("main", [
      thread("main", [turn("m1", 1), turn("m2", 10), turn("m3", 11), turn("m4", 12)]),
      fork("first", "main", "m1", 1.5, [turn("f1", 2)]),
      fork("second", "main", "m1", 1.6, [turn("s1", 3)]),
      fork("late", "main", "m4", 12.5, [turn("l1", 13)]),
    ]);

    expect(laneOf(layout, "first")).toBe(-1);
    expect(laneOf(layout, "second")).toBe(1);
    expect(laneOf(layout, "late")).toBe(-1);
    expect(labelOf(layout, "first")?.room).toBe(pointOf(layout, "m4").column);
  });

  it("says when a fork last moved, and how far its parent has gone on since it left", () => {
    const layout = layoutOf("main", [
      thread("main", [turn("m1", 1), turn("m2", 10), turn("m3", 11), turn("m4", 12)]),
      fork("ended", "main", "m1", 1.5, [turn("e1", 2, { completedAt: 2.5 })]),
      fork("asking", "main", "m3", 11.5, [turn("a1", 13)], { activity: "waiting" }),
      fork("fresh", "main", "m4", 12.5, []),
    ]);

    expect(labelOf(layout, "ended")).toMatchObject({ state: "idle", lastActiveAt: 2.5, behind: 3 });
    expect(labelOf(layout, "asking")).toMatchObject({
      state: "waiting",
      lastActiveAt: 13,
      behind: 1,
    });
    expect(labelOf(layout, "fresh")).toMatchObject({
      state: "not started",
      lastActiveAt: 12.5,
      behind: 0,
    });
  });
});

describe("foldLineage", () => {
  const quiet = Array.from({ length: 10 }, (_, index) => turn(`m${index + 1}`, index + 1));
  const layout = layoutOf("main", [
    thread("main", quiet),
    fork("side", "main", "m6", 6.5, [turn("s1", 6.6)]),
  ]);
  const columnOf = (folded: LineageLayout, runId: string) =>
    folded.points.find((point) => point.turn?.runId === runId)?.column;

  it("folds quiet stretches into a column each, keeping forks, ends and the latest turns", () => {
    const folded = foldLineage(layout, new Set());

    // m1 starts the line, m6 is the fork, s1 ends the fork with its label's room after it, and
    // m8–m10 are the latest; m2–m5 fold.
    expect(folded.folds).toEqual([
      {
        key: "m2",
        column: 1,
        lanes: [{ lane: 0, turns: 4 }],
        messageIds: new Set(["message-m2", "message-m3", "message-m4", "message-m5"]),
      },
    ]);
    expect(folded.foldable).toBe(1);
    expect(folded.columns).toBe(layout.columns - 3);
    expect(columnOf(folded, "m1")).toBe(0);
    expect(columnOf(folded, "m3")).toBeUndefined();
    expect(columnOf(folded, "m6")).toBe(2);
    expect(folded.lines.find((line) => line.threadId === "side")?.fork?.column).toBe(2);
    expect(folded.here.column).toBe(columnOf(folded, "m10"));
  });

  it("leaves a stretch drawn once it is unfolded, by key or all at once", () => {
    expect(foldLineage(layout, new Set(["m2"]))).toMatchObject({
      folds: [],
      foldable: 1,
      columns: layout.columns,
    });
    expect(foldLineage(layout, "all").folds).toEqual([]);
  });

  it("leaves stretches too short to save a column", () => {
    const short = layoutOf("main", [thread("main", quiet.slice(0, 5))]);
    expect(foldLineage(short, new Set()).foldable).toBe(0);
  });
});
