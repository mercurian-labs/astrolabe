import { describe, expect, it } from "vite-plus/test";

import type { CommandPaletteActionItem, CommandPaletteGroup } from "../CommandPalette.logic";
import {
  buildSearchPaletteGroups,
  composeEmptyQueryPlanRows,
  filterSearchPaletteGroups,
  noteItemValue,
  resolveCurrentProjectId,
  resolveProjectPick,
} from "./SearchPalette.logic";

const VISITED = "2026-08-08T00:00:00.000Z";

const plan = (
  planId: string,
  updatedAt: string,
  overrides: {
    hasPendingInput?: boolean;
    isWorking?: boolean;
    visitedAt?: string | undefined;
  } = {},
) => ({
  planId,
  updatedAt,
  hasPendingInput: overrides.hasPendingInput ?? false,
  isWorking: overrides.isWorking ?? false,
  // Seen by default, so a plan is quiet unless a test says otherwise.
  visitedAt: "visitedAt" in overrides ? overrides.visitedAt : VISITED,
});

const item = (value: string, searchTerms: readonly string[]): CommandPaletteActionItem => ({
  kind: "action",
  value,
  searchTerms,
  title: value,
  icon: null,
  run: async () => {},
});

const group = (value: string, items: readonly CommandPaletteActionItem[]): CommandPaletteGroup => ({
  value,
  label: value,
  items,
});

describe("memory search results", () => {
  it("places memory after projects and gives notes stable values", () => {
    const groups = buildSearchPaletteGroups({
      actionItems: [item("action:new-plan", ["new"])],
      planItems: [item("plan:one", ["one"])],
      projectItems: [item("project:one", ["one"])],
      noteItems: [item(noteItemValue("Composer"), ["Composer"])],
      sectionItems: [item("section:memory", ["memory"])],
    });
    expect(groups.map((entry) => entry.value)).toEqual([
      "actions",
      "plans",
      "projects",
      "memory",
      "workspace",
    ]);
    expect(noteItemValue("Composer")).toBe("note:Composer");
  });
});

describe("composeEmptyQueryPlanRows", () => {
  it("puts what needs you first: awaiting input, then unseen, then recents", () => {
    const rows = composeEmptyQueryPlanRows([
      plan("recent", "2026-08-07T00:00:00.000Z"),
      plan("unseen", "2026-08-02T00:00:00.000Z", { visitedAt: "2026-08-01T00:00:00.000Z" }),
      plan("asking", "2026-08-01T00:00:00.000Z", { hasPendingInput: true }),
    ]);

    expect(rows.map((row) => row.planId)).toEqual(["asking", "unseen", "recent"]);
  });

  it("orders newest first inside each tier", () => {
    const rows = composeEmptyQueryPlanRows([
      plan("asking-old", "2026-08-01T00:00:00.000Z", { hasPendingInput: true }),
      plan("asking-new", "2026-08-05T00:00:00.000Z", { hasPendingInput: true }),
      plan("quiet-old", "2026-08-02T00:00:00.000Z"),
      plan("quiet-new", "2026-08-06T00:00:00.000Z"),
    ]);

    expect(rows.map((row) => row.planId)).toEqual([
      "asking-new",
      "asking-old",
      "quiet-new",
      "quiet-old",
    ]);
  });

  it("surfaces a working plan through recency, not urgency", () => {
    const rows = composeEmptyQueryPlanRows([
      plan("working", "2026-08-01T00:00:00.000Z", { isWorking: true }),
      plan("unseen", "2026-08-02T00:00:00.000Z", { visitedAt: "2026-08-01T00:00:00.000Z" }),
      plan("recent", "2026-08-07T00:00:00.000Z"),
    ]);

    expect(rows.map((row) => row.planId)).toEqual(["unseen", "recent", "working"]);
  });

  it("pads to the limit and stops there", () => {
    const plans = Array.from({ length: 20 }, (_, index) =>
      plan(`plan-${index}`, `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
    );

    expect(composeEmptyQueryPlanRows(plans)).toHaveLength(12);
    expect(composeEmptyQueryPlanRows(plans, 3).map((row) => row.planId)).toEqual([
      "plan-19",
      "plan-18",
      "plan-17",
    ]);
  });

  it("invents nothing when there are fewer plans than the limit", () => {
    const rows = composeEmptyQueryPlanRows([plan("only", "2026-08-01T00:00:00.000Z")]);
    expect(rows.map((row) => row.planId)).toEqual(["only"]);
  });
});

describe("filterSearchPaletteGroups", () => {
  it("ranks exact over prefix over substring, across kinds", () => {
    const groups = filterSearchPaletteGroups({
      groups: [
        group("plans", [
          item("plan:substring", ["Rewrite the plan runner"]),
          item("plan:exact", ["Plan"]),
          item("plan:prefix", ["Planning the migration"]),
        ]),
      ],
      query: "plan",
    });

    expect(groups[0]?.items.map((entry) => entry.value)).toEqual([
      "plan:exact",
      "plan:prefix",
      "plan:substring",
    ]);
  });

  it("matches a plan on its project name", () => {
    const groups = filterSearchPaletteGroups({
      groups: [group("plans", [item("plan:one", ["Untitled work", "Astrolabe"])])],
      query: "astro",
    });

    expect(groups[0]?.items.map((entry) => entry.value)).toEqual(["plan:one"]);
  });

  it("keeps source order when matches rank alike", () => {
    const groups = filterSearchPaletteGroups({
      groups: [
        group("plans", [
          item("plan:first", ["Migrate the tree"]),
          item("plan:second", ["Migrate the palette"]),
        ]),
      ],
      query: "migrate",
    });

    expect(groups[0]?.items.map((entry) => entry.value)).toEqual(["plan:first", "plan:second"]);
  });

  it("restricts to actions behind >, and filters within them", () => {
    const groups = [
      group("actions", [
        item("action:new-plan", ["New plan"]),
        item("action:new-project", ["New project"]),
      ]),
      group("plans", [item("plan:one", ["New ideas"])]),
    ];

    expect(filterSearchPaletteGroups({ groups, query: ">" }).map((entry) => entry.value)).toEqual([
      "actions",
    ]);
    expect(filterSearchPaletteGroups({ groups, query: ">" })[0]?.items).toHaveLength(2);

    const filtered = filterSearchPaletteGroups({ groups, query: ">project" });
    expect(filtered.map((entry) => entry.value)).toEqual(["actions"]);
    expect(filtered[0]?.items.map((entry) => entry.value)).toEqual(["action:new-project"]);
  });

  it("drops groups that match nothing", () => {
    const groups = filterSearchPaletteGroups({
      groups: [
        group("plans", [item("plan:one", ["Tree"])]),
        group("projects", [item("project:one", ["Astrolabe"])]),
      ],
      query: "astro",
    });

    expect(groups.map((entry) => entry.value)).toEqual(["projects"]);
  });
});

describe("resolveProjectPick", () => {
  it("opens the project's most recently active plan", () => {
    expect(
      resolveProjectPick([
        { planId: "older", updatedAt: "2026-08-01T00:00:00.000Z" },
        { planId: "newest", updatedAt: "2026-08-06T00:00:00.000Z" },
      ]),
    ).toEqual({ kind: "open-plan", planId: "newest" });
  });

  it("starts the first plan when the project has none", () => {
    expect(resolveProjectPick([])).toEqual({ kind: "start-first-plan" });
  });
});

describe("resolveCurrentProjectId", () => {
  const plans = [{ planId: "plan-1", projectId: "project-a" }];
  const draftsById = { "draft-1": { projectId: "project-b" } };

  it("reads the owning project from inside a plan", () => {
    expect(resolveCurrentProjectId({ pathname: "/plans/plan-1", plans, draftsById })).toBe(
      "project-a",
    );
    expect(resolveCurrentProjectId({ pathname: "/plans/plan-1/timeline", plans, draftsById })).toBe(
      "project-a",
    );
  });

  it("reads the draft's project from inside a draft", () => {
    expect(resolveCurrentProjectId({ pathname: "/plans/draft/draft-1", plans, draftsById })).toBe(
      "project-b",
    );
  });

  it("knows nothing anywhere else", () => {
    expect(resolveCurrentProjectId({ pathname: "/", plans, draftsById })).toBeNull();
    expect(resolveCurrentProjectId({ pathname: "/repositories", plans, draftsById })).toBeNull();
    expect(resolveCurrentProjectId({ pathname: "/plans/unknown", plans, draftsById })).toBeNull();
    expect(
      resolveCurrentProjectId({ pathname: "/plans/draft/unknown", plans, draftsById }),
    ).toBeNull();
  });
});
