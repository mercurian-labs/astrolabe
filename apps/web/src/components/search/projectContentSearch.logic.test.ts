import { EnvironmentId, ProjectId, type ProjectContentMatch } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { repositoryTabKey } from "../repositories/repositoryTabs";
import {
  focusedCheckoutTarget,
  groupContentSearchMatches,
  type ContentSearchRow,
} from "./projectContentSearch.logic";

function match(
  path: string,
  lineNumber: number,
  context?: { readonly before: string[]; readonly after: string[] },
): ProjectContentMatch {
  return {
    path,
    lineNumber,
    lineContent: `match ${lineNumber}`,
    matchRanges: [{ start: 0, end: 5 }],
    ...(context ? { contextBefore: context.before, contextAfter: context.after } : {}),
  };
}

const describeRows = (rows: ReadonlyArray<ContentSearchRow>) =>
  rows.map((row) =>
    row.kind === "match"
      ? `${row.match.lineNumber}*`
      : row.kind === "context"
        ? `${row.lineNumber}`
        : "…",
  );

describe("groupContentSearchMatches", () => {
  it("groups by file in arrival order and keeps each match's result index", () => {
    const groups = groupContentSearchMatches([
      match("b.ts", 4),
      match("a.ts", 1),
      match("b.ts", 9),
    ]);
    expect(groups.map((group) => [group.path, group.matchCount])).toEqual([
      ["b.ts", 2],
      ["a.ts", 1],
    ]);
    const firstRows = groups[0]!.rows;
    expect(firstRows.map((row) => (row.kind === "match" ? row.match.resultIndex : null))).toEqual([
      0,
      null,
      2,
    ]);
    expect(describeRows(firstRows)).toEqual(["4*", "…", "9*"]);
  });

  it("merges context that touches or overlaps and separates excerpts that don't", () => {
    const [group] = groupContentSearchMatches([
      match("a.ts", 3, { before: ["l1", "l2"], after: ["l4", "l5"] }),
      match("a.ts", 6, { before: ["l4", "l5"], after: ["l7", "l8"] }),
      match("a.ts", 20, { before: ["l18", "l19"], after: ["l21", "l22"] }),
    ]);
    expect(describeRows(group!.rows)).toEqual([
      "1",
      "2",
      "3*",
      "4",
      "5",
      "6*",
      "7",
      "8",
      "…",
      "18",
      "19",
      "20*",
      "21",
      "22",
    ]);
  });

  it("never hides a match behind the previous match's trailing context", () => {
    const [group] = groupContentSearchMatches([
      match("a.ts", 1, { before: [], after: ["match 2", "l3"] }),
      match("a.ts", 2, { before: ["match 1"], after: ["l3", "l4"] }),
    ]);
    expect(describeRows(group!.rows)).toEqual(["1*", "2*", "3", "4"]);
  });

  it("drops context lines that would fall before the first line", () => {
    const [group] = groupContentSearchMatches([match("a.ts", 1, { before: [], after: ["l2"] })]);
    expect(describeRows(group!.rows)).toEqual(["1*", "2"]);
  });
});

describe("focusedCheckoutTarget", () => {
  const environmentId = EnvironmentId.make("environment");
  const projectId = ProjectId.make("project");
  const projects = [{ environmentId, id: projectId, title: "scratch", workspaceRoot: "/repo" }];
  const fileIn = (cwd: string) =>
    repositoryTabKey({ kind: "file", environmentId, projectId, cwd, path: "src/a.ts" });

  it("searches the checkout of the Projects tab in front", () => {
    expect(focusedCheckoutTarget(fileIn("/repo"), projects)).toEqual({
      environmentId,
      projectId,
      cwd: "/repo",
      worktreePath: null,
      projectName: "scratch",
    });
    expect(focusedCheckoutTarget(fileIn("/worktrees/a"), projects)).toMatchObject({
      cwd: "/worktrees/a",
      worktreePath: "/worktrees/a",
    });
  });

  it("finds nothing in front of a chat or a project it no longer knows", () => {
    expect(focusedCheckoutTarget("chat:environment:thread", projects)).toBeNull();
    expect(focusedCheckoutTarget(fileIn("/repo"), [])).toBeNull();
  });
});
