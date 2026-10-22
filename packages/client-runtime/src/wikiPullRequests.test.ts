import type { ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  changeRequestPullRequests,
  pullRequestNudge,
  unmergedPullRequests,
} from "./wikiPullRequests.ts";

const link = (
  number: number,
  state: "open" | "closed" | "merged" | null,
  source = "created",
): ThreadPullRequestLink =>
  ({
    host: "github.com",
    repository: "acme/app",
    number,
    source,
    snapshot: state === null ? null : { state },
  }) as unknown as ThreadPullRequestLink;

describe("a wiki change request and its thread's pull requests", () => {
  it("offers to merge once a pull request merged", () => {
    expect(pullRequestNudge("open", [link(1, "open"), link(2, "merged")])).toMatchObject({
      kind: "merge",
      pullRequest: { number: 2 },
    });
  });

  it("offers to close once every pull request closed without merging", () => {
    expect(pullRequestNudge("open", [link(1, "closed"), link(2, "closed")])).toMatchObject({
      kind: "close",
      pullRequest: { number: 1 },
    });
    expect(pullRequestNudge("open", [link(1, "closed"), link(2, "open")])).toBeNull();
    expect(pullRequestNudge("open", [link(1, "closed"), link(2, null)])).toBeNull();
  });

  it("offers nothing once the change request settled, or with no pull request", () => {
    expect(pullRequestNudge("merged", [link(1, "merged")])).toBeNull();
    expect(pullRequestNudge("closed", [link(1, "closed")])).toBeNull();
    expect(pullRequestNudge("open", [])).toBeNull();
  });

  it("leaves dismissed stack layers out, and names the ones not merged yet", () => {
    const links = [link(1, "open", "stack-dismissed"), link(2, "open"), link(3, "merged")];
    expect(changeRequestPullRequests(links).map((entry) => entry.number)).toEqual([2, 3]);
    expect(unmergedPullRequests(links).map((entry) => entry.number)).toEqual([2]);
  });
});
