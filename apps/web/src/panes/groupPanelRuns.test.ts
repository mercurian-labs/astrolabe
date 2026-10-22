import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import type { ChangeGroupMember } from "@t3tools/shared/changeGroups";
import { describe, expect, it } from "vite-plus/test";

import { changeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import { wikiTabKey } from "~/components/wiki/wikiTabs";
import { pullRequestSurfaceId } from "~/rightPanelStore";
import {
  activateTab,
  openBeside,
  openTab,
  startingArrangement,
  surfaceKey,
  type Arrangement,
} from "./arrangement";
import {
  closeRunEntries,
  openRunEntries,
  parseGroupPanelRuns,
  placeRunTabs,
  reconcilePanelRuns,
  runEntryOfKey,
  runGroupOf,
  runTabKeys,
  threadRunGroups,
  type GroupPanelRuns,
  type PanelRunsInput,
  type RunEntry,
  type RunGroup,
  type RunPullRequest,
} from "./groupPanelRuns";
import { leaves } from "./tree";

const environmentId = EnvironmentId.make("env");
const groupKey = changeGroupTabKey({ environmentId, groupId: "g1" });
const otherKey = changeGroupTabKey({ environmentId, groupId: "g2" });
const docs = wikiTabKey({
  kind: "change-request",
  environmentId,
  wikiId: WikiId.make("wiki"),
  changeRequestId: WikiChangeRequestId.make("cr-1"),
});
const pr: RunPullRequest = {
  projectId: "project-a",
  host: "github.com",
  repository: "o/r",
  number: 7,
};
const prEntry: RunEntry = { kind: "pull-request", ...pr };
const prKey = surfaceKey(pullRequestSurfaceId(pr));
const diff = surfaceKey("diff");
const files = surfaceKey("files");

/** The first group: its own tab, the docs and the pull request. */
const group: RunGroup = {
  key: groupKey,
  entryIds: new Set([groupKey, docs, "pull-request:o/r#7"]),
};
/** The second group: its own tab only. */
const other: RunGroup = { key: otherKey, entryIds: new Set([otherKey]) };

function panes(arrangement: Arrangement) {
  return leaves(arrangement.root).map((leaf) => leaf.tabs);
}

function actives(arrangement: Arrangement) {
  return leaves(arrangement.root).map((leaf) => leaf.active);
}

function reconcile(overrides: Partial<PanelRunsInput> & Pick<PanelRunsInput, "arrangement">) {
  return reconcilePanelRuns({
    pullRequests: new Map(),
    groups: [group],
    runs: {},
    seen: {},
    ...overrides,
  });
}

/** A thread's panel: Diff in front, Files behind it, in one pane. */
const surfaces = activateTab(openTab(openTab(startingArrangement(), diff), files), diff);

describe("a group's run in the store", () => {
  it("opens entries once, after those open, and clears them from the closed", () => {
    const closed = closeRunEntries({}, groupKey, [docs]);
    const runs = openRunEntries(closed, groupKey, [{ kind: "group" }, prEntry, { kind: "group" }]);
    expect(runs[groupKey]).toEqual({ open: [{ kind: "group" }, prEntry], closed: [docs] });
    const reopened = openRunEntries(runs, groupKey, [{ kind: "wiki-change-request", key: docs }]);
    expect(reopened[groupKey]).toEqual({
      open: [{ kind: "group" }, prEntry, { kind: "wiki-change-request", key: docs }],
      closed: [],
    });
    expect(openRunEntries(reopened, groupKey, [prEntry])).toBe(reopened);
  });

  it("closes entries into the closed, which its other threads close too", () => {
    const runs = openRunEntries({}, groupKey, [{ kind: "group" }, prEntry]);
    const closed = closeRunEntries(runs, groupKey, ["pull-request:o/r#7"]);
    expect(closed[groupKey]).toEqual({ open: [{ kind: "group" }], closed: ["pull-request:o/r#7"] });
    expect(closeRunEntries(closed, groupKey, ["pull-request:o/r#7"])).toBe(closed);
    expect(closeRunEntries(closed, groupKey, [])).toBe(closed);
  });

  it("names a pull request by repository and number, whatever project opened it", () => {
    const runs = openRunEntries({}, groupKey, [prEntry]);
    expect(openRunEntries(runs, groupKey, [{ ...prEntry, projectId: "project-b" }])).toBe(runs);
  });

  it("reads the entries a group's tab opens together from their keys", () => {
    const full = surfaceKey(
      pullRequestSurfaceId({
        environmentId,
        projectId: "project-a",
        host: "github.com",
        repository: "o/r",
        number: 7,
      }),
    );
    expect(runEntryOfKey(groupKey, groupKey)).toEqual({ kind: "group" });
    expect(runEntryOfKey(groupKey, docs)).toEqual({ kind: "wiki-change-request", key: docs });
    expect(runEntryOfKey(groupKey, full)).toEqual(prEntry);
    expect(runEntryOfKey(groupKey, "chat:env:t1")).toBeNull();
  });
});

describe("a thread's panel catching up with its group's run", () => {
  it("opens the run's tabs together where the thread's surfaces are, none in front", () => {
    const runs = openRunEntries({}, groupKey, [{ kind: "group" }, prEntry]);
    const beside = openBeside(surfaces, surfaceKey("browser:a"), "p0", "right", { focus: false });
    const change = reconcile({ arrangement: beside, runs });
    expect(panes(change.arrangement)).toEqual([
      [diff, files, groupKey, prKey],
      [surfaceKey("browser:a")],
    ]);
    expect(actives(change.arrangement)).toEqual(actives(beside));
    expect(change.arrangement.focused).toBe(beside.focused);
    expect(change.addPullRequests).toEqual([pr]);
    expect(change.runs).toBe(runs);
    expect(change.seen).toEqual({ [groupKey]: [groupKey, "pull-request:o/r#7"] });
  });

  it("opens a missing tab beside the run's others, in the run's order, in their pane", () => {
    const runs = openRunEntries({}, groupKey, [
      { kind: "group" },
      { kind: "wiki-change-request", key: docs },
      prEntry,
    ]);
    const split = openBeside(surfaces, groupKey, "p0", "right", { focus: false });
    const holding = openTab(split, prKey, leaves(split.root)[1]!.id, false);
    const change = reconcile({
      arrangement: holding,
      runs,
      pullRequests: new Map([[pullRequestSurfaceId(pr), pr]]),
      seen: { [groupKey]: [groupKey, "pull-request:o/r#7"] },
    });
    expect(panes(change.arrangement)).toEqual([
      [diff, files],
      [groupKey, docs, prKey],
    ]);
    expect(actives(change.arrangement)).toEqual(actives(holding));
    expect(change.addPullRequests).toEqual([]);
  });

  it("opens into the focused pane when the thread has no surfaces, its empty tab in front", () => {
    const runs = openRunEntries({}, groupKey, [{ kind: "group" }]);
    const change = reconcile({ arrangement: startingArrangement(), runs });
    expect(panes(change.arrangement)).toEqual([["empty/0", groupKey]]);
    expect(actives(change.arrangement)).toEqual(["empty/0"]);
  });

  it("takes in what it held before the group formed, such as the thread's own pull request", () => {
    const held = openTab(surfaces, prKey, "p0", false);
    const change = reconcile({
      arrangement: held,
      pullRequests: new Map([[pullRequestSurfaceId(pr), pr]]),
    });
    expect(change.runs[groupKey]).toEqual({ open: [prEntry], closed: [] });
    expect(change.arrangement).toBe(held);
  });

  it("closes, as it shows, what the run closed beside another thread", () => {
    const runs = closeRunEntries(openRunEntries({}, groupKey, [{ kind: "group" }]), groupKey, [
      "pull-request:o/r#7",
    ]);
    const held = openTab(openTab(surfaces, groupKey, "p0", false), prKey, "p0", false);
    const change = reconcile({
      arrangement: held,
      runs,
      pullRequests: new Map([[pullRequestSurfaceId(pr), pr]]),
    });
    expect(panes(change.arrangement)).toEqual([[diff, groupKey, files]]);
    expect(change.removeSurfaceIds).toEqual([pullRequestSurfaceId(pr)]);
    expect(change.runs).toBe(runs);
  });

  it("matches a pull request by repository and number, so another project's tab is no copy", () => {
    const own = { ...pr, projectId: "project-b" };
    const ownKey = surfaceKey(pullRequestSurfaceId(own));
    const held = openTab(surfaces, ownKey, "p0", false);
    const change = reconcile({
      arrangement: held,
      runs: openRunEntries({}, groupKey, [prEntry]),
      pullRequests: new Map([[pullRequestSurfaceId(own), own]]),
    });
    expect(change.arrangement).toBe(held);
    expect(change.addPullRequests).toEqual([]);
  });

  it("leaves out entries no longer in the group", () => {
    const runs = openRunEntries({}, groupKey, [{ kind: "group" }, prEntry]);
    const change = reconcile({
      arrangement: surfaces,
      runs,
      groups: [{ key: groupKey, entryIds: new Set([groupKey]) }],
    });
    expect(panes(change.arrangement)).toEqual([[diff, files, groupKey]]);
    expect(change.addPullRequests).toEqual([]);
  });

  it("shows each of its groups' runs", () => {
    let runs: GroupPanelRuns = openRunEntries({}, groupKey, [{ kind: "group" }]);
    runs = openRunEntries(runs, otherKey, [{ kind: "group" }]);
    const change = reconcile({ arrangement: surfaces, runs, groups: [group, other] });
    expect(panes(change.arrangement)).toEqual([[diff, files, groupKey, otherKey]]);
    expect(Object.keys(change.seen)).toEqual([groupKey, otherKey]);
  });
});

describe("a thread's panel on screen, and its group's run", () => {
  const runs = openRunEntries({}, groupKey, [{ kind: "group" }, prEntry]);
  const held = openTab(openTab(surfaces, groupKey, "p0", false), prKey, "p0", false);
  const pullRequests = new Map([[pullRequestSurfaceId(pr), pr]]);
  const seen = { [groupKey]: [groupKey, "pull-request:o/r#7"] };

  it("closes in the run a tab closed here", () => {
    const closedHere = openTab(surfaces, groupKey, "p0", false);
    const change = reconcile({ arrangement: closedHere, runs, pullRequests, seen });
    expect(change.runs[groupKey]).toEqual({
      open: [{ kind: "group" }],
      closed: ["pull-request:o/r#7"],
    });
    expect(change.arrangement).toBe(closedHere);
    expect(change.addPullRequests).toEqual([]);
  });

  it("opens in the run a tab opened here, even one it closed before", () => {
    const closed = closeRunEntries(runs, groupKey, [docs]);
    const opened = openTab(held, docs, "p0", false);
    const change = reconcile({ arrangement: opened, runs: closed, pullRequests, seen });
    expect(change.runs[groupKey]).toEqual({
      open: [{ kind: "group" }, prEntry, { kind: "wiki-change-request", key: docs }],
      closed: [],
    });
    expect(change.arrangement).toBe(opened);
  });

  it("follows the run as another thread changes it, and then holds still", () => {
    const elsewhere = closeRunEntries(
      openRunEntries(runs, groupKey, [{ kind: "wiki-change-request", key: docs }]),
      groupKey,
      ["pull-request:o/r#7"],
    );
    const change = reconcile({ arrangement: held, runs: elsewhere, pullRequests, seen });
    expect(panes(change.arrangement)).toEqual([[diff, groupKey, docs, files]]);
    expect(change.removeSurfaceIds).toEqual([pullRequestSurfaceId(pr)]);
    expect(change.runs).toBe(elsewhere);
    const again = reconcile({
      arrangement: change.arrangement,
      runs: change.runs,
      seen: change.seen,
    });
    expect(again.arrangement).toBe(change.arrangement);
    expect(again.runs).toBe(change.runs);
    expect(again.addPullRequests).toEqual([]);
    expect(again.removeSurfaceIds).toEqual([]);
  });

  it("forgets a group the thread left", () => {
    const change = reconcile({ arrangement: held, runs, pullRequests, seen, groups: [] });
    expect(change.seen).toEqual({});
    expect(change.arrangement).toBe(held);
  });
});

describe("placing a run's tabs", () => {
  it("changes nothing with nothing missing", () => {
    expect(placeRunTabs(surfaces, [groupKey], new Set())).toBe(surfaces);
  });

  it("puts a tab before the run's first one when it comes first", () => {
    const held = openTab(surfaces, prKey, "p0", false);
    const placed = placeRunTabs(held, [groupKey, prKey], new Set([groupKey]));
    expect(panes(placed)).toEqual([[diff, groupKey, prKey, files]]);
  });
});

describe("the groups a thread works in", () => {
  const member = (ref: ChangeGroupMember["ref"]): ChangeGroupMember => ({
    key: "member",
    ref,
    side: ref.kind === "pull-request" ? "code" : "docs",
    reason: "same-thread",
    note: "",
    title: "",
    place: "",
    state: "open",
    url: null,
    threadId: null,
    updatedAt: null,
    branch: null,
    baseBranch: null,
  });
  const changeGroup = (groupId: string, threadIds: string[]): EnvironmentChangeGroup => ({
    environmentId,
    groupId,
    title: groupId,
    threads: [],
    threadIds,
    members: [
      member({ kind: "pull-request", host: "github.com", repository: "o/r", number: 7 }),
      member({
        kind: "wiki-change-request",
        wikiId: WikiId.make("wiki"),
        changeRequestId: WikiChangeRequestId.make("cr-1"),
      }),
      member({ kind: "thread", threadId: "t9" }),
    ],
    state: "in-sync",
    armed: false,
  });

  it("are those listing it, each with its own tab, pull requests and docs", () => {
    const groups = [changeGroup("g1", ["t1", "t2"]), changeGroup("g2", ["t3"])];
    const thread = scopeThreadRef(environmentId, ThreadId.make("t1"));
    expect(threadRunGroups(groups, thread)).toEqual([runGroupOf(groups[0]!)]);
    expect([...runGroupOf(groups[0]!).entryIds]).toEqual([groupKey, "pull-request:o/r#7", docs]);
  });
});

describe("stored runs", () => {
  it("keep well-formed entries, each once, and closed entries that are not open", () => {
    expect(
      parseGroupPanelRuns({
        [groupKey]: {
          open: [
            { kind: "group" },
            { kind: "group" },
            prEntry,
            { kind: "pull-request", number: 1 },
          ],
          closed: [groupKey, docs, docs, 4],
        },
        broken: { open: "x", closed: [] },
      }),
    ).toEqual({ [groupKey]: { open: [{ kind: "group" }, prEntry], closed: [docs] } });
    expect(parseGroupPanelRuns([1])).toEqual({});
  });

  it("hold their open tabs as each shows beside a thread", () => {
    const runs = openRunEntries({}, groupKey, [{ kind: "group" }, prEntry]);
    expect(runTabKeys(closeRunEntries(runs, otherKey, [otherKey]))).toEqual([groupKey, prKey]);
  });
});
