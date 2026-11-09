import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import { pullRequestGroups } from "./pullRequestListGroups.logic";

const entry = (number: number) =>
  ({
    environmentId: "env-1",
    host: "github.com",
    repository: "acme/handbook",
    projectId: "project-1",
    number,
    title: `Pull request ${number}`,
    updatedAt: "2026-11-06T00:00:00.000Z",
    state: "open",
    isDraft: false,
    author: { login: "me" },
    labels: [],
    viewerReviewRequested: false,
  }) as unknown as EnvironmentPullRequestEntry;

describe("pullRequestGroups", () => {
  it("leaves hidden rows out of every group, the partitions' own queries included", () => {
    const { groups } = pullRequestGroups({
      known: [entry(1), entry(2), entry(3)],
      providers: [],
      viewers: {},
      involvement: "all",
      localFilters: {},
      hasLocalFilters: false,
      text: "",
      answeredLocally: false,
      baselineEmpty: false,
      held: undefined,
      authored: [entry(1), entry(2)],
      reviewing: [entry(3)],
      partitionsWanted: true,
      hidden: ({ number }) => number !== 2,
    });
    expect(groups.flatMap((group) => group.entries.map(({ number }) => number))).toEqual([2]);
  });
});
