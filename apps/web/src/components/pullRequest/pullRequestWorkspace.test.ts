import { describe, expect, it, vi } from "vitest";

vi.mock("~/panes/workspace", () => ({
  WORKSPACE_LAYOUT_KEY: "test-layout",
  workspace: { show: vi.fn(), open: vi.fn() },
}));

import {
  pullRequestTabKey,
  settlePullRequestTabReveal,
  showPullRequest,
  usePullRequestTabReveals,
} from "./pullRequestWorkspace";

const target = {
  environmentId: "environment-1",
  projectId: "project-1",
  host: "github.com",
  repository: "owner/repo",
  number: 7,
};
const commentUrl = "https://github.com/owner/repo/pull/7#issuecomment-1";
const fileUrl = "https://github.com/owner/repo/pull/7/files#diff-abc";

describe("showPullRequest", () => {
  it("hands a clicked link to the pull request's tab until the tab shows it", () => {
    usePullRequestTabReveals.setState({ byTabKey: {} });
    const key = pullRequestTabKey(target);
    expect(key).not.toBeNull();

    showPullRequest({ ...target, revealUrl: commentUrl }, "replace");
    expect(usePullRequestTabReveals.getState().byTabKey[key!]).toBe(commentUrl);

    showPullRequest({ ...target, revealUrl: fileUrl }, "replace");
    settlePullRequestTabReveal(key!, commentUrl);
    expect(usePullRequestTabReveals.getState().byTabKey[key!]).toBe(fileUrl);

    settlePullRequestTabReveal(key!, fileUrl);
    expect(usePullRequestTabReveals.getState().byTabKey[key!]).toBeUndefined();
  });
});
