import {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanId,
  ThreadId,
  type PlanDetail,
  type PlanLineRuntimeRecord,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveThreadSpaceRoute,
  resolveThreadSpaceRouteNavigation,
} from "./threadSpaceRoute.logic";

const commit = (commitId: string, sequence: number, parents: string[]) => ({
  _tag: "message" as const,
  commitId: MercurianCommitId.make(commitId),
  sequence,
  parents: parents.map((parent) => MercurianCommitId.make(parent)),
  published: false,
  authorKind: "human" as const,
  createdAt: "2026-09-04T12:00:00.000Z",
  text: commitId,
});

const runtime = (threadId: string, lineRootCommitId: string | null) =>
  ({
    planId: PlanId.make("plan-1"),
    lineRootCommitId: lineRootCommitId === null ? null : MercurianCommitId.make(lineRootCommitId),
    threadId: ThreadId.make(threadId),
    homeRepositoryId: MercurianRepositoryId.make("repository-1"),
    branch: `line/${threadId}`,
    worktreePath: "/repo",
    unreachableRepositories: [],
    snapshotOid: null,
    snapshotKind: null,
    departedRef: null,
    branchMovement: null,
  }) satisfies PlanLineRuntimeRecord;

const detail = (lineRuntimes: PlanLineRuntimeRecord[], lastVisitedThreadId?: ThreadId) =>
  ({
    timeline: [commit("root", 1, []), commit("fork", 2, ["root"])],
    lineRuntimes,
    ...(lastVisitedThreadId === undefined ? {} : { lastVisitedThreadId }),
  }) satisfies Pick<PlanDetail, "timeline" | "lineRuntimes" | "lastVisitedThreadId">;

describe("resolveThreadSpaceRoute", () => {
  it("prefers the requested line, then the last visited line, then the first line", () => {
    const first = runtime("first", "root");
    const visited = runtime("visited", "fork");
    const requested = runtime("requested", null);

    expect(
      resolveThreadSpaceRoute({
        detail: detail([first, visited, requested], visited.threadId),
        isPending: false,
        search: { line: requested.threadId },
      }),
    ).toEqual({ kind: "thread", threadId: requested.threadId });
    expect(
      resolveThreadSpaceRoute({
        detail: detail([first, visited], visited.threadId),
        isPending: false,
        search: {},
      }),
    ).toEqual({ kind: "thread", threadId: visited.threadId });
    expect(
      resolveThreadSpaceRoute({
        detail: detail([first, visited]),
        isPending: false,
        search: { at: MercurianCommitId.make("ignored") },
      }),
    ).toEqual({ kind: "thread", threadId: first.threadId });
  });

  it("opens a first line that has no runtime", () => {
    expect(
      resolveThreadSpaceRoute({
        detail: detail([]),
        isPending: false,
        search: {},
      }),
    ).toEqual({ kind: "needsOpen", lineRootCommitId: MercurianCommitId.make("root") });
  });

  it("marks a missing plan for home navigation", () => {
    const resolution = resolveThreadSpaceRoute({
      detail: null,
      isPending: false,
      search: {},
    });

    expect(resolution).toEqual({ kind: "missing" });
    expect(resolveThreadSpaceRouteNavigation(resolution)).toEqual({ to: "/", replace: true });
  });
});
