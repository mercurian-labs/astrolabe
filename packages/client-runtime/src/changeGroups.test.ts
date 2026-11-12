import { EnvironmentId, ProjectId, ThreadId, type ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  branchGroupKey,
  changeGroupsByBranch,
  matchComposerChangeGroupItems,
  threadChangeRequestsTarget,
  type EnvironmentChangeGroup,
} from "./changeGroups.ts";
import type { EnvironmentThreadShell } from "./state/models.ts";

const environmentId = EnvironmentId.make("environment");
const shop = ProjectId.make("shop");
const docs = ProjectId.make("docs");

const thread = (id: string, projectId: ProjectId, branch: string | null) =>
  ({ environmentId, id: ThreadId.make(id), projectId, branch }) as EnvironmentThreadShell;

const group = (groupId: string, threadIds: string[], memberThreadIds: string[] = []) =>
  ({
    environmentId,
    groupId,
    threadIds,
    members: memberThreadIds.map((threadId) => ({ threadId })),
  }) as unknown as EnvironmentChangeGroup;

describe("changeGroupsByBranch", () => {
  it("puts a branch in the groups of the threads that worked on it, in their project", () => {
    const login = group("login", ["a"]);
    const billing = group("billing", ["a", "b"]);
    const byBranch = changeGroupsByBranch({
      groups: [login, billing],
      threads: [thread("a", shop, "feature/login"), thread("b", docs, "main")],
      threadBranches: () => ({ a: ["feature/spike"], b: ["feature/login"] }),
    });
    const groupsOf = (projectId: ProjectId, branch: string) =>
      (byBranch.get(branchGroupKey(environmentId, projectId, branch)) ?? []).map(
        (entry) => entry.groupId,
      );

    expect(groupsOf(shop, "feature/login")).toEqual(["login", "billing"]);
    expect(groupsOf(shop, "feature/spike")).toEqual(["login", "billing"]);
    // The same name in another repository is another branch.
    expect(groupsOf(docs, "feature/login")).toEqual(["billing"]);
    expect(groupsOf(docs, "main")).toEqual([]);
  });
});

describe("threadChangeRequestsTarget", () => {
  const link = (number: number, linkedAt: string): ThreadPullRequestLink => ({
    host: "github.com",
    repository: "acme/shop",
    number,
    url: `https://github.com/acme/shop/pull/${number}`,
    source: "manual",
    linkedAt,
    snapshot: null,
    stack: null,
  });
  const first = link(1, "2026-01-01T00:00:00.000Z");
  const second = link(2, "2026-01-02T00:00:00.000Z");
  const target = (groups: EnvironmentChangeGroup[], pullRequests: ThreadPullRequestLink[]) =>
    threadChangeRequestsTarget({ groups, environmentId, threadId: "a", pullRequests });

  it("opens the group a thread is in, the one holding its own change requests first", () => {
    const fork = group("fork", ["b", "a"], ["b"]);
    const own = group("own", ["a", "c"], ["a", "c"]);
    expect(target([fork, own], [first])).toEqual({ kind: "group", group: own });
    expect(target([fork], [first])).toEqual({ kind: "group", group: fork });
  });

  it("opens the pull request of a thread in no group, the current one of several", () => {
    const elsewhere = group("elsewhere", ["b", "c"], ["b", "c"]);
    expect(target([elsewhere], [first])).toEqual({ kind: "pull-request", link: first });
    expect(target([], [first, second])).toEqual({ kind: "pull-request", link: second });
    expect(target([], [])).toBeNull();
  });
});

describe("matchComposerChangeGroupItems", () => {
  const named = (groupId: string, title: string, threadIds: string[], prs: [number, string][]) =>
    ({
      environmentId,
      groupId,
      title,
      state: "in-sync",
      threadIds,
      members: prs.map(([number, prTitle]) => ({
        title: prTitle,
        ref: { kind: "pull-request", host: "github.com", repository: "acme/app", number },
      })),
    }) as unknown as EnvironmentChangeGroup;
  // Derived newest first.
  const groups = [
    named("refunds", "Refunds", ["r"], [[12, "Partial refunds"]]),
    named("billing", "Billing", ["b"], [[7, "Refund webhooks"]]),
    { ...named("elsewhere", "Refunds", [], []), environmentId: EnvironmentId.make("other") },
  ];
  const match = (query: string, threadId: string | null = null) =>
    matchComposerChangeGroupItems({ groups, environmentId, threadId, query }).map(
      (item) => item.group.groupId,
    );

  it("matches a group's title, a member's title or a pull request's number, on this environment", () => {
    expect(match("refund")).toEqual(["refunds", "billing"]);
    expect(match("webhooks")).toEqual(["billing"]);
    expect(match("#12")).toEqual(["refunds"]);
    expect(match("7")).toEqual(["billing"]);
    expect(match("")).toEqual([]);
  });

  it("puts the thread's own groups first, then the rest as recent as they are", () => {
    expect(match("refund", "b")).toEqual(["billing", "refunds"]);
  });
});
