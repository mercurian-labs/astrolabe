import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  branchGroupKey,
  changeGroupsByBranch,
  type EnvironmentChangeGroup,
} from "./changeGroups.ts";
import type { EnvironmentThreadShell } from "./state/models.ts";

const environmentId = EnvironmentId.make("environment");
const shop = ProjectId.make("shop");
const docs = ProjectId.make("docs");

const thread = (id: string, projectId: ProjectId, branch: string | null) =>
  ({ environmentId, id: ThreadId.make(id), projectId, branch }) as EnvironmentThreadShell;

const group = (groupId: string, threadIds: string[]) =>
  ({ environmentId, groupId, threadIds }) as unknown as EnvironmentChangeGroup;

describe("changeGroupsByBranch", () => {
  it("puts a branch in the groups of the threads that worked on it, in their project", () => {
    const login = group("login", ["a"]);
    const billing = group("billing", ["a", "b"]);
    const byBranch = changeGroupsByBranch({
      groups: [login, billing],
      threads: [thread("a", shop, "feature/login"), thread("b", docs, "main")],
      threadBranches: () => ({ a: ["feature/spike"], b: ["feature/login"] }),
    });
    const groupsOf = (projectId: ProjectId, branch: string) =>
      (byBranch.get(branchGroupKey(environmentId, projectId, branch)) ?? []).map(
        (entry) => entry.groupId,
      );

    expect(groupsOf(shop, "feature/login")).toEqual(["login", "billing"]);
    expect(groupsOf(shop, "feature/spike")).toEqual(["login", "billing"]);
    // The same name in another repository is another branch.
    expect(groupsOf(docs, "feature/login")).toEqual(["billing"]);
    expect(groupsOf(docs, "main")).toEqual([]);
  });
});
