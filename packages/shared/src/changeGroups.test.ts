import {
  DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
  type ChangeGroupDecisions,
  type ThreadPullRequestLink,
  type WikiChangeRequestId,
  type WikiId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveChangeGroups,
  type ChangeGroupThread,
  type ChangeGroupWikiChange,
} from "./changeGroups.ts";

const settings = DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS;
const link = (
  number: number,
  title: string,
  state: "open" | "merged" | "closed" = "open",
  updatedAt = "2026-10-19T10:00:00Z",
) =>
  ({
    host: "github.com",
    repository: "acme/app",
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    source: "manual",
    linkedAt: "2026-10-19T09:00:00Z",
    snapshot: {
      state,
      title,
      headBranch: "feature",
      baseBranch: "main",
      isDraft: false,
      updatedAt,
      syncedAt: updatedAt,
    },
    stack: null,
  }) as unknown as ThreadPullRequestLink;
const thread = (
  id: string,
  pullRequests: ThreadPullRequestLink[] = [],
  parent: { id: string; as: "fork" | "subagent" } | null = null,
  more: { readonly title?: string; readonly branch?: string } = {},
): ChangeGroupThread => ({
  id,
  title: more.title ?? `Thread ${id}`,
  lineage: { parentThreadId: parent?.id ?? null, relationshipToParent: parent?.as ?? null },
  pullRequests,
  branch: more.branch ?? null,
});
const decided = (
  groupId: string,
  change: Partial<Pick<ChangeGroupDecisions, "added" | "removed">>,
): ChangeGroupDecisions => ({
  groupId,
  title: null,
  armed: null,
  added: change.added ?? [],
  removed: change.removed ?? [],
  dismissed: [],
  pending: [],
  updatedAt: "2026-10-19T12:00:00Z",
});
const threadsOf = (groups: ReturnType<typeof derive>, groupId: string) =>
  groups
    .find((group) => group.groupId === groupId)
    ?.threads.map((entry) => [entry.threadId, entry.reason]);
const docs = (
  id: string,
  threadId: string | null,
  title = "Document the feature",
  status: "open" | "merged" | "closed" = "open",
  updatedAt = "2026-10-19T11:00:00Z",
): ChangeGroupWikiChange => ({
  wikiName: "Handbook",
  changeRequest: {
    changeRequestId: id as WikiChangeRequestId,
    wikiId: "w1" as WikiId,
    title,
    status,
    threadId: threadId as never,
    updatedAt,
  },
});
const derive = (
  threads: ChangeGroupThread[],
  wikiChanges: ChangeGroupWikiChange[] = [],
  decisions: ChangeGroupDecisions[] = [],
  overrides: Partial<typeof settings> = {},
) =>
  deriveChangeGroups({ threads, wikiChanges, decisions, settings: { ...settings, ...overrides } });

describe("change groups", () => {
  it("gather a thread's pull requests and the docs it wrote", () => {
    const [group] = derive([thread("t1", [link(12, "Add search")])], [docs("cr1", "t1")]);
    expect(group?.groupId).toBe("t1");
    expect(group?.members.map((member) => [member.key, member.reason])).toEqual([
      ["pr:github.com/acme/app#12", "same-thread"],
      ["wiki:w1/cr1", "same-thread"],
    ]);
    expect(group?.state).toBe("in-sync");
  });

  it("leave a lone change request ungrouped", () => {
    expect(derive([thread("t1", [link(12, "Add search")])])).toEqual([]);
  });

  it("gather a coordinator's children, and forks, as the settings allow", () => {
    const threads = [
      thread("coordinator", [link(1, "Server")]),
      thread("child", [link(2, "Client")], { id: "coordinator", as: "subagent" }),
      thread("fork", [], { id: "child", as: "fork" }),
    ];
    const wiki = [docs("cr1", "fork")];
    const [group] = derive(threads, wiki);
    expect(group?.groupId).toBe("coordinator");
    expect(group?.members.map((member) => member.reason)).toEqual([
      "same-thread",
      "coordinator",
      "lineage",
    ]);
    expect(derive(threads, wiki, [], { coordinator: false }).map((g) => g.groupId)).toEqual([
      "child",
    ]);
  });

  it("move members as people decide, one group at a time", () => {
    const threads = [
      thread("a", [link(1, "One"), link(2, "Two")]),
      thread("b", [link(3, "Three")]),
    ];
    const decision: ChangeGroupDecisions = {
      groupId: "b",
      title: "Three and two",
      armed: false,
      added: [
        {
          member: { kind: "pull-request", host: "github.com", repository: "acme/app", number: 2 },
          reason: "suggested",
          note: "Both change the importer",
        },
      ],
      removed: [],
      dismissed: [],
      pending: [],
      updatedAt: "2026-10-19T12:00:00Z",
    };
    const groups = derive(threads, [], [decision]);
    const b = groups.find((group) => group.groupId === "b");
    expect(b?.title).toBe("Three and two");
    expect(b?.armed).toBe(false);
    expect(b?.members.map((member) => [member.key, member.reason, member.note])).toEqual([
      ["pr:github.com/acme/app#3", "same-thread", ""],
      ["pr:github.com/acme/app#2", "suggested", "Both change the importer"],
    ]);
    // Group a keeps one member, so it no longer shows.
    expect(groups.some((group) => group.groupId === "a")).toBe(false);
    const removed = derive(
      threads,
      [docs("cr1", "b")],
      [{ ...decision, added: [], removed: ["wiki:w1/cr1"] }],
    );
    expect(removed.find((group) => group.groupId === "b")?.members).toHaveLength(1);
  });

  it("join docs written outside a thread by a shared issue key", () => {
    const [group] = derive(
      [thread("t1", [link(1, "M-12 Search server"), link(2, "Search client")])],
      [docs("cr1", null, "M-12: document search")],
    );
    expect(group?.members.find((member) => member.side === "docs")?.reason).toBe("reference");
    expect(
      derive(
        [thread("t1", [link(1, "M-12 Search server"), link(2, "Search client")])],
        [docs("cr1", null, "M-12: document search")],
        [],
        { references: false },
      )[0]?.members,
    ).toHaveLength(2);
  });

  it("list the threads working on the effort: its own, those that opened members, their family", () => {
    const threads = [
      thread("coordinator", [link(1, "Server")]),
      thread("child", [link(2, "Client")], { id: "coordinator", as: "subagent" }),
      // A fork that lost: it opened nothing, but it is part of the effort.
      thread("losing-fork", [], { id: "child", as: "fork" }),
      thread("stranger"),
    ];
    const groups = derive(threads);
    expect(threadsOf(groups, "coordinator")).toEqual([
      ["coordinator", "opened"],
      ["child", "opened"],
      ["losing-fork", "fork"],
    ]);
    expect(groups[0]?.threadIds).toEqual(["coordinator", "child", "losing-fork"]);
    expect(threadsOf(derive(threads, [], [], { lineage: false }), "coordinator")).toEqual([
      ["coordinator", "opened"],
      ["child", "opened"],
    ]);
  });

  it("add threads on a member pull request's branch, never on a shared branch", () => {
    const threads = [
      thread("t1", [link(1, "Search"), link(2, "Search UI")]),
      thread("review", [], null, { branch: "feature" }),
      thread("on-main", [], null, { branch: "main" }),
    ];
    expect(threadsOf(derive(threads), "t1")).toEqual([
      ["t1", "opened"],
      ["review", "same-branch"],
    ]);
    expect(threadsOf(derive(threads, [], [], { sameBranch: false }), "t1")).toEqual([
      ["t1", "opened"],
    ]);
  });

  it("add threads whose title or branch names the group's issue key", () => {
    const threads = [
      thread("t1", [link(1, "M-12 Search server"), link(2, "Search client")]),
      thread("titled", [], null, { title: "Investigate M-12" }),
      thread("branched", [], null, { branch: "venk/m-12-search" }),
      thread("other", [], null, { title: "Investigate M-13" }),
    ];
    expect(threadsOf(derive(threads), "t1")).toEqual([
      ["t1", "opened"],
      ["titled", "reference"],
      ["branched", "reference"],
    ]);
    expect(threadsOf(derive(threads, [], [], { references: false }), "t1")).toEqual([
      ["t1", "opened"],
    ]);
  });

  it("keep a thread in every group it was added to, and out of one it was taken out of", () => {
    const threads = [
      thread("a", [link(1, "One"), link(2, "Two")]),
      thread("b", [link(3, "Three"), link(4, "Four")]),
      thread("shared"),
    ];
    const added = [
      {
        member: { kind: "thread" as const, threadId: "shared" },
        reason: "manual" as const,
        note: "",
      },
    ];
    const both = derive(threads, [], [decided("a", { added }), decided("b", { added })]);
    expect(threadsOf(both, "a")).toEqual([
      ["a", "opened"],
      ["shared", "manual"],
    ]);
    expect(threadsOf(both, "b")).toEqual([
      ["b", "opened"],
      ["shared", "manual"],
    ]);
    // A thread added to a group takes no change request with it.
    expect(both.find((group) => group.groupId === "a")?.members).toHaveLength(2);
    const takenOut = derive(
      threads,
      [],
      [decided("a", { added }), decided("b", { added, removed: ["thread:shared", "thread:b"] })],
    );
    expect(threadsOf(takenOut, "a")).toEqual([
      ["a", "opened"],
      ["shared", "manual"],
    ]);
    expect(threadsOf(takenOut, "b")).toEqual([]);
  });

  it("say where the group stands", () => {
    const state = (
      prs: ThreadPullRequestLink[],
      wiki: ChangeGroupWikiChange[],
      overrides: Partial<typeof settings> = {},
    ) => derive([thread("t", prs)], wiki, [], overrides)[0]?.state;
    expect(state([link(1, "A"), link(2, "B")], [])).toBe("docs-missing");
    expect(state([link(1, "A", "merged")], [docs("c", "t", "D", "merged")])).toBe("merged");
    expect(state([link(1, "A")], [docs("c", "t", "D", "merged")])).toBe("waiting-on-code");
    const newerCode = [link(1, "A", "open", "2026-10-19T12:00:00Z")];
    expect(state(newerCode, [docs("c", "t")])).toBe("docs-behind");
    expect(state(newerCode, [docs("c", "t")], { flagDocsBehind: false })).toBe("in-sync");
  });
});
