import { describe, expect, it } from "vite-plus/test";

import { issueTabKey, issueTabTitle, issueTargetOfKey } from "./issueTabs";

const linear = {
  environmentId: "env:1",
  projectId: "project-1",
  tracker: "linear",
  host: "Linear.app",
  scope: "ENG",
  key: "ENG-12",
};

describe("issue tab keys", () => {
  it("name an issue in full and read back, the scope keeping its case", () => {
    expect(issueTargetOfKey(issueTabKey(linear))).toEqual({ ...linear, host: "linear.app" });
  });

  it("read back an issue with no host", () => {
    const { host: _host, ...hostless } = linear;
    expect(issueTargetOfKey(issueTabKey(hostless))).toEqual(hostless);
  });

  it("read no other key", () => {
    expect(issueTargetOfKey("chat:env:thread")).toBeNull();
    expect(issueTargetOfKey("issue:env:project")).toBeNull();
    expect(issueTargetOfKey("issue:env:project:linear::ENG:")).toBeNull();
  });

  it("title a numbered issue with its scope, and a keyed one by its key", () => {
    expect(issueTabTitle({ ...linear, tracker: "github", scope: "owner/repo", key: "7" })).toBe(
      "#7 owner/repo",
    );
    expect(issueTabTitle(linear)).toBe("ENG-12");
  });
});
