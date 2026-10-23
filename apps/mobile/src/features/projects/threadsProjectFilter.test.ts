import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import type { EnvironmentId, ProjectId, WikiId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findHomeProjectScope, type HomeProjectScope } from "../home/homeThreadList";
import {
  findThreadsProjectScope,
  REPOSITORIES_SCOPE_KEY,
  threadsProjectFilterOptions,
  wikiCheckouts,
  WIKIS_SCOPE_KEY,
} from "./threadsProjectFilter";

const env = "env-1" as EnvironmentId;
const scope = (key: string, title: string, projectId: string): HomeProjectScope => ({
  key,
  title,
  representative: { id: projectId } as unknown as EnvironmentProject,
  projects: [{ id: projectId } as unknown as EnvironmentProject],
  projectRefs: [{ environmentId: env, projectId: projectId as ProjectId }],
});
const scopes = [
  scope("astrolabe", "astrolabe", "p1"),
  scope("handbook-folder", "handbook", "p2"),
  scope("branding", "branding", "p3"),
];
const checkouts = wikiCheckouts([
  {
    environmentId: env,
    wiki: { wikiId: "w1" as WikiId, name: "Team handbook", projectId: "p2" },
  } as unknown as WikiOverview,
]);

describe("the thread list's project menu", () => {
  it("lists the repositories, then the wikis, each under a heading", () => {
    expect(threadsProjectFilterOptions(scopes, checkouts).map((option) => option.label)).toEqual([
      "Repositories",
      "astrolabe",
      "branding",
      "Wikis",
      "Team handbook · Wiki",
    ]);
  });

  it("narrows a heading to every project of its kind, as one scope", () => {
    const repositories = findThreadsProjectScope(
      scopes,
      REPOSITORIES_SCOPE_KEY,
      checkouts,
      findHomeProjectScope,
    );
    expect(repositories?.projectRefs.map((ref) => ref.projectId)).toEqual(["p1", "p3"]);
    expect(repositories?.title).toBe("your repositories");
    const wikis = findThreadsProjectScope(scopes, WIKIS_SCOPE_KEY, checkouts, findHomeProjectScope);
    expect(wikis?.projectRefs.map((ref) => ref.projectId)).toEqual(["p2"]);
  });

  it("names a wiki's checkout for the wiki, and leaves All projects unscoped", () => {
    expect(
      findThreadsProjectScope(scopes, "handbook-folder", checkouts, findHomeProjectScope)?.title,
    ).toBe("Team handbook");
    expect(findThreadsProjectScope(scopes, null, checkouts, findHomeProjectScope)).toBeNull();
    expect(
      findThreadsProjectScope(scopes, WIKIS_SCOPE_KEY, new Map(), findHomeProjectScope),
    ).toBeNull();
  });
});
