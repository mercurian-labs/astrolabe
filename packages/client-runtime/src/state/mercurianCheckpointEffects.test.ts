import { describe, expect, it } from "vite-plus/test";
import {
  MercurianCommitId,
  MercurianProjectId,
  MessageId,
  PlanId,
  ThreadId,
  type OrchestrationCheckpointFile,
  type PlanCheckpointRecord,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import {
  checkpointDocumentHistory,
  checkpointEffects,
  checkpointFileEffects,
} from "./mercurianCheckpointEffects.ts";
const id = MercurianCommitId.make;
const file = (
  path: string,
  extra: Partial<OrchestrationCheckpointFile> = {},
): OrchestrationCheckpointFile => ({
  path,
  kind: "modified",
  additions: 1,
  deletions: 0,
  ...extra,
});
const record = (
  owner: string,
  files: OrchestrationCheckpointFile[] = [],
): PlanCheckpointRecord => ({
  ownerCommitId: id(owner),
  planId: PlanId.make("plan"),
  projectId: MercurianProjectId.make("project"),
  lineRootCommitId: id("root"),
  revision: 1,
  updateSequence: 1,
  capture: {
    status: "ready",
    terminal: true,
    summaryStatus: "ready",
    files: [],
    repositories: [
      {
        repositoryId: "repo",
        repositoryName: "Repo",
        captureStatus: "ready",
        summaryStatus: "ready",
        afterSnapshotOid: "after",
        branchTipOid: "tip",
        files,
      },
    ],
  },
});
const message = (commit: string, parents: string[] = []): PlanTimelineItem => ({
  _tag: "message",
  text: "",
  commitId: id(commit),
  parents: parents.map((parent) => id(parent)),
  authorKind: "human",
  published: false,
  sequence: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
});
describe("checkpoint effects", () => {
  it("uses roles on both sides, excludes plan/spec from memory, and counts remaining files as code", () => {
    expect(
      checkpointFileEffects(
        file("plan", { beforeDocumentRole: "plan", afterDocumentRole: "memory" }),
      ),
    ).toEqual(["plan"]);
    expect(
      checkpointFileEffects(file("spec", { beforeDocumentRole: "spec", kind: "deleted" })),
    ).toEqual(["spec"]);
    expect(checkpointFileEffects(file("memory", { afterDocumentRole: "memory" }))).toEqual([
      "memory",
    ]);
    expect(checkpointFileEffects(file("image", { binary: true }))).toEqual(["code"]);
    expect(
      checkpointEffects(record("root", [file("plan", { afterDocumentRole: "plan" })])).categories,
    ).toEqual(["plan"]);
  });
  it("keeps branch movement separate from file effects and status", () => {
    const base = record("root");
    const result = checkpointEffects({
      ...base,
      capture: {
        ...base.capture!,
        partial: true,
        repositories: [
          { ...base.capture!.repositories![0]!, branchMovement: { kind: "added", count: 2 } },
        ],
      },
    });
    expect(result.categories).toEqual([]);
    expect(result.branchMovements).toEqual([
      { repositoryId: "repo", movement: { kind: "added", count: 2 } },
    ]);
    expect(result.status.partial).toBe(true);
  });
  it("never calls unknown, saving, or failed capture a plain turn", () => {
    const base = record("root");
    const { capture: _, ...bare } = base;
    const saving = checkpointEffects({
      ...bare,
      request: {
        threadId: ThreadId.make("thread"),
        messageId: MessageId.make("root"),
        state: "preparing",
      },
    });
    expect(saving.status.saving).toBe(true);
    expect(saving.plain).toBe(false);
    expect(checkpointEffects(bare).plain).toBe(false);
    expect(
      checkpointEffects({ ...base, capture: { status: "error", terminal: true, files: [] } }).plain,
    ).toBe(false);
    const cancelled = checkpointEffects({
      ...bare,
      request: {
        threadId: ThreadId.make("thread"),
        messageId: MessageId.make("root"),
        state: "cancelled",
      },
    });
    expect(cancelled.status.saving).toBe(false);
    expect(cancelled.status.unanswered).toBe(true);
    expect(cancelled.categories).toEqual([]);
  });
  it("retains partial successes but blocks coherent forks when a member snapshot is missing", () => {
    const base = record("root", [file("code")]);
    const result = checkpointEffects({
      ...base,
      capture: {
        ...base.capture!,
        partial: true,
        repositories: [
          ...base.capture!.repositories!,
          {
            repositoryId: "failed",
            repositoryName: "Failed",
            captureStatus: "error",
            summaryStatus: "unavailable",
            files: [],
          },
        ],
      },
    });
    expect(result.categories).toEqual(["code"]);
    expect(result.status.partial).toBe(true);
    expect(result.status.snapshotsAvailable).toBe(false);
    expect(result.status.failed).toBe(true);
    expect(result.plain).toBe(false);
  });
  it("summary-only failure leaves captured snapshots usable", () => {
    const base = record("root");
    const result = checkpointEffects({
      ...base,
      capture: {
        ...base.capture!,
        summaryStatus: "error",
        repositories: [
          {
            ...base.capture!.repositories![0]!,
            summaryStatus: "error",
            summaryError: "diff unavailable",
          },
        ],
      },
    });
    expect(result.status.snapshotsAvailable).toBe(true);
    expect(result.status.summaryReady).toBe(false);
    expect(result.plain).toBe(false);
  });
});
describe("selected document ancestry", () => {
  const timeline = [
    message("inherited"),
    message("root", ["inherited"]),
    message("a", ["root"]),
    message("other", ["inherited"]),
    message("merge", ["a", "other"]),
    message("future", ["merge"]),
  ];
  const plan = (path: string) => file(path, { afterDocumentRole: "plan" });
  const records = [
    record("inherited", [plan("inherited.md")]),
    record("root", [plan("draft.md")]),
    record("a", [
      file("plan.md", {
        kind: "renamed",
        previousPath: "draft.md",
        beforeDocumentRole: "plan",
        afterDocumentRole: "plan",
      }),
    ]),
    record("other", [plan("unrelated.md")]),
    record("merge", [plan("merged.md")]),
    record("future", [file("plan.md", { kind: "deleted", beforeDocumentRole: "plan" })]),
  ];
  const read = (selected: string) =>
    checkpointDocumentHistory({
      timeline,
      records,
      selectedCommitId: id(selected),
      lineRootCommitId: id("root"),
      forkParentCommitId: id("inherited"),
    });
  it("excludes inherited prefix, future edits, and source merge ancestry", () => {
    expect(read("a").map((entry) => entry.path)).toEqual(["plan.md"]);
    expect(read("merge").map((entry) => entry.path)).toEqual(["plan.md", "merged.md"]);
    expect(read("other")).toEqual([]);
  });
  it("keeps renames and deletions inspectable and counts only the carrying merge delta", () => {
    expect(read("a")[0]?.previousPath).toBe("draft.md");
    expect(read("future").find((entry) => entry.path === "plan.md")?.deleted).toBe(true);
    expect(read("merge").find((entry) => entry.path === "merged.md")?.carryingCommitId).toBe(
      "merge",
    );
  });
  it("uses the exact response link and never borrows an unrelated line's record", () => {
    const result = checkpointDocumentHistory({
      timeline,
      records: [
        { ...record("root", [plan("future.md")]), responseCommitId: id("future") },
        { ...record("a", [plan("wrong.md")]), lineRootCommitId: id("other") },
      ],
      selectedCommitId: id("a"),
      lineRootCommitId: id("root"),
    });
    expect(result).toEqual([]);
  });
});
