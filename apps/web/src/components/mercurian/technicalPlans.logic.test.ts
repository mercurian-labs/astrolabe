import { describe, expect, it } from "vite-plus/test";

import {
  MercurianCommitId,
  MercurianRepositoryId,
  type MercurianRepository,
  type PlanTechnicalPlan,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import {
  deriveMenuItems,
  isStale,
  latestTechnicalPlansOnPath,
  sourceRevisionOnPath,
} from "./technicalPlans.logic";

const fields = (commitId: string, sequence: number, parents: ReadonlyArray<string> = []) => ({
  commitId: MercurianCommitId.make(commitId),
  sequence,
  parents: parents.map((parent) => MercurianCommitId.make(parent)),
  published: false,
  authorKind: "human" as const,
  createdAt: "2026-08-10T00:00:00.000Z",
});

const revision = (commitId: string, sequence: number): PlanTimelineItem => ({
  _tag: "plan-revision",
  ...fields(commitId, sequence),
});

const technical = (
  commitId: string,
  sequence: number,
  repositoryId: string,
  sourceRevisionCommitId: string,
): PlanTechnicalPlan => ({
  ...fields(commitId, sequence),
  repositoryId: MercurianRepositoryId.make(repositoryId),
  repositoryName: repositoryId,
  sourceRevisionCommitId: MercurianCommitId.make(sourceRevisionCommitId),
});

const repository = (repositoryId: string): MercurianRepository => ({
  repositoryId: MercurianRepositoryId.make(repositoryId),
  name: repositoryId,
  path: `/repos/${repositoryId}`,
  hasGit: true,
  hosting: null,
  scripts: [],
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
});

describe("technical plan path logic", () => {
  it("picks each repository's newest derivation on the path", () => {
    const first = technical("tech-a-1", 2, "repo-a", "revision-1");
    const second = technical("tech-b", 3, "repo-b", "revision-1");
    const newest = technical("tech-a-2", 4, "repo-a", "revision-1");
    const latest = latestTechnicalPlansOnPath([
      revision("revision-1", 1),
      { _tag: "technical-plan", ...first },
      { _tag: "technical-plan", ...second },
      { _tag: "technical-plan", ...newest },
    ]);
    expect(latest.get(MercurianRepositoryId.make("repo-a"))?.commitId).toBe("tech-a-2");
    expect(latest.get(MercurianRepositoryId.make("repo-b"))?.commitId).toBe("tech-b");
  });

  it("flips stale exactly when a later revision enters the rendered path", () => {
    const source = revision("revision-1", 1);
    const item = technical("tech-a", 2, "repo-a", "revision-1");
    const atDerivation: ReadonlyArray<PlanTimelineItem> = [
      source,
      { _tag: "technical-plan", ...item },
    ];
    expect(sourceRevisionOnPath(atDerivation)).toBe("revision-1");
    expect(isStale(item, atDerivation)).toBe(false);
    expect(isStale(item, [...atDerivation, revision("revision-2", 3)])).toBe(true);
    // Looking back truncates the later revision and restores that point's truth.
    expect(isStale(item, atDerivation)).toBe(false);
  });

  it("derives never, current, and stale menu states with global disable reasons", () => {
    const repositories = [repository("repo-a"), repository("repo-b"), repository("repo-c")];
    const path: ReadonlyArray<PlanTimelineItem> = [
      revision("revision-1", 1),
      {
        _tag: "technical-plan",
        ...technical("tech-a", 2, "repo-a", "revision-1"),
      },
      revision("revision-2", 3),
      {
        _tag: "technical-plan",
        ...technical("tech-b", 4, "repo-b", "revision-2"),
      },
    ];
    const items = deriveMenuItems(repositories, path, "# Plan");
    expect(items.map(({ state, disabledReason }) => [state, disabledReason])).toEqual([
      ["stale", undefined],
      ["up-to-date", "up-to-date"],
      ["never-derived", undefined],
    ]);

    expect(deriveMenuItems(repositories, path, "").map((item) => item.disabledReason)).toEqual([
      "plan-empty",
      "plan-empty",
      "plan-empty",
    ]);
    expect(
      deriveMenuItems(repositories, path, "# Plan", true).map((item) => item.disabledReason),
    ).toEqual(["turn-active", "turn-active", "turn-active"]);
  });
});
