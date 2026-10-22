import type {
  OrchestrationV2ThreadLineage,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  forkFamily,
  lineageChangeKey,
  lineageInput,
  threadActivity,
  type LineageShell,
} from "./lineageFamily";

const at = (seconds: number) => DateTime.makeUnsafe(seconds * 1000);

const shell = (
  id: string,
  lineage: { parentThreadId?: string; relationshipToParent?: "fork" | "subagent" } = {},
  extra: Record<string, unknown> = {},
) =>
  ({
    id,
    title: `Thread ${id}`,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id, ...lineage },
    status: "idle",
    activityRunStatus: null,
    latestRunId: null,
    deletedAt: null,
    pendingRuntimeRequest: null,
    hasActionableProposedPlan: false,
    ...extra,
  }) as unknown as LineageShell;

const forkOf = (id: string, parentThreadId: string, extra: Record<string, unknown> = {}) =>
  shell(id, { parentThreadId, relationshipToParent: "fork" }, extra);

describe("forkFamily", () => {
  const shells = [
    shell("root"),
    forkOf("fork", "root"),
    forkOf("forkOfFork", "fork"),
    shell("agent", { parentThreadId: "root", relationshipToParent: "subagent" }),
    forkOf("deleted", "root", { deletedAt: at(1) }),
    shell("other"),
  ];

  it("climbs a fork to its root and gathers every fork below it, subagents left out", () => {
    expect(forkFamily(shells, "forkOfFork").map((entry) => entry.id)).toEqual([
      "root",
      "fork",
      "forkOfFork",
    ]);
    expect(forkFamily(shells, "other").map((entry) => entry.id)).toEqual(["other"]);
    expect(forkFamily(shells, "agent").map((entry) => entry.id)).toEqual(["agent"]);
  });
});

describe("lineageChangeKey", () => {
  const viewed = (parts: Partial<Record<"contextTransfers" | "checkpoints", unknown>> = {}) =>
    ({ contextTransfers: [], checkpoints: [], ...parts }) as unknown as Pick<
      OrchestrationV2ThreadProjection,
      "contextTransfers" | "checkpoints"
    >;
  const family = [shell("root"), forkOf("fork", "root", { latestRunId: "f1", status: "running" })];
  const key = lineageChangeKey(family, "fork", viewed());

  it("holds while only streamed output and unrelated threads change", () => {
    const streamed = family.map((entry) =>
      Object.assign({}, entry, { updatedAt: at(9), latestVisibleMessage: { text: "more" } }),
    );
    expect(
      lineageChangeKey([...streamed, shell("other", {}, { status: "running" })], "fork", viewed()),
    ).toBe(key);
    expect(
      lineageChangeKey(
        family,
        "fork",
        viewed({
          contextTransfers: [{ id: "f", type: "fork", status: "consumed", targetRunId: null }],
        }),
      ),
    ).toBe(key);
  });

  it("moves when a turn, a fork, a title, a merge-back or a checkpoint does", () => {
    const changed = [
      [shell("root", {}, { latestRunId: "r2" }), family[1]!],
      [family[0]!, forkOf("fork", "root", { latestRunId: "f1", status: "completed" })],
      [...family, forkOf("sibling", "root")],
      [shell("root", {}, { title: "Renamed" }), family[1]!],
    ];
    for (const shells of changed) expect(lineageChangeKey(shells, "fork", viewed())).not.toBe(key);
    const mergeBack = { id: "m", type: "merge_back", status: "pending", targetRunId: null };
    expect(lineageChangeKey(family, "fork", viewed({ contextTransfers: [mergeBack] }))).not.toBe(
      key,
    );
    expect(lineageChangeKey(family, "fork", viewed({ checkpoints: [{ id: "c1" }] }))).not.toBe(key);
  });
});

describe("lineageInput", () => {
  const run = (id: string, ordinal: number, status: string, text = "") => ({
    id,
    ordinal,
    status,
    requestedAt: at(ordinal),
    completedAt: status === "completed" ? at(ordinal + 0.5) : null,
    model: "gpt-5",
    userMessageId: `message-${id}`,
    text,
    reply: `Answered ${id}`,
    additions: ordinal,
    deletions: 0,
    files: 1,
  });
  const lineage = {
    threads: [
      {
        id: "root",
        title: "Root",
        parentId: null,
        forkRunId: null,
        createdAt: at(0),
        providerInstanceId: "codex",
        archived: false,
        runs: [
          run("r1", 1, "completed", "[image.png](t3-attachment://a)\nFind the bug"),
          run("r2", 2, "rolled_back", "Undo that"),
          run("r3", 3, "running"),
          run("r4", 4, "queued", "Later"),
        ],
      },
      {
        id: "fork",
        title: "Fork",
        parentId: "root",
        forkRunId: "r1",
        createdAt: at(1),
        providerInstanceId: "codex",
        archived: true,
        runs: [run("f1", 1, "running", "Try another way")],
      },
    ],
    mergeBacks: [
      {
        id: "m",
        sourceThreadId: "fork",
        sourceRunId: "f1",
        targetThreadId: "root",
        targetRunId: null,
        createdAt: at(5),
      },
    ],
  } as unknown as OrchestrationV2ThreadLineage;

  it("takes what a thread is doing from its shell, or from its runs when it has none", () => {
    const of = (root: LineageShell) => [...threadActivity(lineage, new Map([["root", root]]))];
    expect(of(shell("root"))).toEqual([["fork", "running"]]);
    expect(of(shell("root", {}, { activityRunStatus: "running" }))).toEqual([
      ["root", "running"],
      ["fork", "running"],
    ]);
    // A question or approval waits on the person even mid-turn; so does a plan to accept.
    const asking = { activityRunStatus: "running", pendingRuntimeRequest: { kind: "approval" } };
    expect(of(shell("root", {}, asking))[0]).toEqual(["root", "waiting"]);
    expect(of(shell("root", {}, { hasActionableProposedPlan: true }))[0]).toEqual([
      "root",
      "waiting",
    ]);
  });

  it("draws the turns the conversation shows, labelled with what was asked", () => {
    const input = lineageInput(lineage, "root", new Map([["root", "running"]]));

    expect(input.threads[0]).toMatchObject({ id: "root", parentId: null, activity: "running" });
    expect(input.threads[0]!.turns).toEqual([
      {
        runId: "r1",
        messageId: "message-r1",
        at: 1000,
        running: false,
        label: "Find the bug",
        completedAt: 1500,
        model: "gpt-5",
        reply: "Answered r1",
        additions: 1,
        deletions: 0,
        files: 1,
      },
      {
        runId: "r3",
        messageId: "message-r3",
        at: 3000,
        running: true,
        label: "Turn 2",
        completedAt: null,
        model: "gpt-5",
        reply: "Answered r3",
        additions: 3,
        deletions: 0,
        files: 1,
      },
    ]);
    expect(input.threads[1]).toMatchObject({ parentId: "root", forkRunId: "r1", activity: null });
    expect(input.mergeBacks).toEqual([
      {
        id: "m",
        sourceThreadId: "fork",
        sourceRunId: "f1",
        targetThreadId: "root",
        targetRunId: null,
        at: 5000,
      },
    ]);
  });
});
