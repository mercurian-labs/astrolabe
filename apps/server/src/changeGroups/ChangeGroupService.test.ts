import {
  ChangeGroupGroupingSettings,
  DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
  type ChangeGroupDecisions,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { deriveChangeGroups, type ChangeGroupThread } from "@t3tools/shared/changeGroups";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  applyChangeGroupChange,
  ChangeGroupStoreJson,
  describeChangeGroup,
  foldThreadBranches,
  migrateWikiMembers,
  withoutWikiMembers,
} from "./ChangeGroupService.ts";

const empty: ChangeGroupDecisions = {
  groupId: "thread-1",
  title: null,
  added: [],
  removed: [],
  dismissed: [],
  pending: [],
  updatedAt: "2026-10-19T00:00:00Z",
};
const decodeStoredChangeGroups = Schema.decodeSync(ChangeGroupStoreJson);
const decodeGroupingSettings = Schema.decodeUnknownSync(ChangeGroupGroupingSettings);
const pr = { kind: "pull-request" as const, host: "github.com", repository: "acme/app", number: 7 };
const at = "2026-10-19T01:00:00Z";

describe("a change group's decisions", () => {
  it("add a member, which undoes taking it out or dismissing it", () => {
    const removed = applyChangeGroupChange(
      empty,
      { type: "remove", memberKey: "pr:github.com/acme/app#7" },
      at,
    );
    expect(removed.removed).toEqual(["pr:github.com/acme/app#7"]);
    const added = applyChangeGroupChange(
      { ...removed, dismissed: ["pr:github.com/acme/app#7"] },
      { type: "add", member: pr, reason: "suggested", note: "Same importer" },
      at,
    );
    expect(added.added).toEqual([{ member: pr, reason: "suggested", note: "Same importer" }]);
    expect(added.removed).toEqual([]);
    expect(added.dismissed).toEqual([]);
    expect(added.updatedAt).toBe(at);
  });

  it("take out an added member", () => {
    const added = applyChangeGroupChange(
      empty,
      { type: "add", member: pr, reason: "manual", note: "" },
      at,
    );
    const removed = applyChangeGroupChange(
      added,
      { type: "remove", memberKey: "pr:github.com/acme/app#7" },
      at,
    );
    expect(removed.added).toEqual([]);
    expect(removed.removed).toEqual(["pr:github.com/acme/app#7"]);
  });

  it("keep an agent's suggestion until someone accepts or dismisses it", () => {
    const suggested = applyChangeGroupChange(
      empty,
      { type: "suggest", member: pr, note: "Same importer" },
      at,
    );
    expect(suggested.pending).toEqual([{ member: pr, note: "Same importer" }]);
    const dismissed = applyChangeGroupChange(
      suggested,
      { type: "dismiss", memberKey: "pr:github.com/acme/app#7" },
      at,
    );
    expect(dismissed.pending).toEqual([]);
    expect(
      applyChangeGroupChange(dismissed, { type: "suggest", member: pr, note: "Again" }, at),
    ).toBe(dismissed);
  });

  it("name the group", () => {
    expect(applyChangeGroupChange(empty, { type: "title", title: "Search" }, at).title).toBe(
      "Search",
    );
  });

  it("still read a file that remembers merging with the code", () => {
    const stored = decodeStoredChangeGroups(
      JSON.stringify({ version: 1, decisions: [{ ...empty, armed: true }] }),
    );
    expect(stored.decisions).toEqual([empty]);
    expect(decodeGroupingSettings({ armByDefault: false })).toEqual(
      DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
    );
  });
});

describe("a thread's branches", () => {
  it("keep every branch it moved through, once each, in order", () => {
    const folded = foldThreadBranches({ t1: ["main"] }, [
      { threadId: "t1", branch: "feature" },
      { threadId: "t1", branch: null },
      { threadId: "t1", branch: "main" },
      { threadId: "t2", branch: "fix" },
      { threadId: "t1", branch: "later" },
    ]);
    expect(folded).toEqual({ t1: ["main", "feature", "later"], t2: ["fix"] });
  });

  it("stay the same record when no event names a new branch", () => {
    const threads = { t1: ["main"] };
    expect(foldThreadBranches(threads, [{ threadId: "t1", branch: "main" }])).toBe(threads);
  });
});

describe("one group in full", () => {
  it("gives each pull request its branches, checks and review, and counts agent runs", () => {
    const link = (number: number, checksState: "passing" | "failing") =>
      ({
        host: "github.com",
        repository: "acme/app",
        number,
        url: `https://github.com/acme/app/pull/${number}`,
        source: "created",
        linkedAt: at,
        snapshot: {
          state: "open",
          title: `Change ${number}`,
          headBranch: `feature-${number}`,
          baseBranch: "main",
          isDraft: false,
          updatedAt: at,
          syncedAt: at,
          checksState,
          reviewDecision: "approved",
        },
        stack: null,
      }) as unknown as ThreadPullRequestLink;
    const threads: ChangeGroupThread[] = [
      {
        id: "root",
        title: "Refunds",
        lineage: { parentThreadId: null, relationshipToParent: null },
        pullRequests: [link(1, "passing")],
        branch: "feature-1",
      },
      {
        id: "child",
        title: "Refunds API",
        lineage: { parentThreadId: "root", relationshipToParent: "subagent" },
        pullRequests: [link(2, "failing")],
        branch: "feature-2",
      },
    ];
    const [group] = deriveChangeGroups({
      threads,
      decisions: [],
      settings: DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
    });
    const detail = describeChangeGroup(group!, threads);
    expect(
      detail.members.map((member) => [member.key, member.branch, member.checks, member.review]),
    ).toEqual([
      ["pr:github.com/acme/app#1", "feature-1", "passing", "approved"],
      ["pr:github.com/acme/app#2", "feature-2", "failing", "approved"],
    ]);
    expect(detail.threads.map((entry) => [entry.threadId, entry.branch])).toEqual([
      ["root", "feature-1"],
    ]);
    expect(detail.agentRuns).toBe(1);
  });
});

describe("a group's wiki change requests after wikis become project roots", () => {
  const wikiMember = (wikiId: string, changeRequestId: string) => ({
    kind: "wiki-change-request" as const,
    wikiId,
    changeRequestId,
  });
  const thread = { kind: "thread" as const, threadId: "thread-2" };
  const pullRequests = new Map([["wiki:w1/cr-open", pr]]);

  it("become their pull requests, and leave without one", () => {
    const { decisions, dropped } = migrateWikiMembers(
      {
        ...empty,
        added: [
          { member: wikiMember("w1", "cr-open"), reason: "manual", note: "The docs" },
          { member: wikiMember("w1", "cr-local"), reason: "manual", note: "" },
          { member: thread, reason: "manual", note: "" },
        ],
        pending: [{ member: wikiMember("w1", "cr-draft"), note: "Same plan" }],
      },
      pullRequests,
    );
    expect(decisions.added).toEqual([
      { member: pr, reason: "manual", note: "The docs" },
      { member: thread, reason: "manual", note: "" },
    ]);
    expect(decisions.pending).toEqual([]);
    expect(dropped).toEqual(["wiki:w1/cr-local", "wiki:w1/cr-draft"]);
  });

  it("rewrite the keys taken out or dismissed, and drop those of no pull request", () => {
    const { decisions, dropped } = migrateWikiMembers(
      {
        ...empty,
        removed: ["wiki:w1/cr-open", "pr:github.com/acme/app#7", "wiki:w1/cr-local"],
        dismissed: ["wiki:other/cr-1", "thread:thread-3"],
      },
      pullRequests,
    );
    expect(decisions.removed).toEqual(["pr:github.com/acme/app#7"]);
    expect(decisions.dismissed).toEqual(["thread:thread-3"]);
    expect(dropped).toEqual([]);
  });

  it("still read from a stored file, which loads without them", () => {
    const stored = decodeStoredChangeGroups(
      JSON.stringify({
        version: 1,
        decisions: [
          {
            ...empty,
            added: [
              { member: wikiMember("w1", "cr-local"), reason: "manual", note: "" },
              { member: pr, reason: "manual", note: "" },
            ],
            removed: ["wiki:w1/cr-gone"],
          },
        ],
      }),
    );
    const [decisions] = withoutWikiMembers(stored).decisions;
    expect(decisions?.added).toEqual([{ member: pr, reason: "manual", note: "" }]);
    expect(decisions?.removed).toEqual([]);
  });
});
