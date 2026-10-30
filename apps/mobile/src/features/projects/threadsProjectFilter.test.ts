import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findHomeProjectScope, type HomeProjectScope } from "../home/homeThreadList";
import {
  findThreadsProjectScope,
  REPOSITORIES_SCOPE_KEY,
  threadsProjectFilterOptions,
} from "./threadsProjectFilter";

const env = "env-1" as EnvironmentId;
const scope = (key: string, title: string, projectId: string): HomeProjectScope => ({
  key,
  title,
  representative: { id: projectId } as unknown as EnvironmentProject,
  projects: [{ id: projectId } as unknown as EnvironmentProject],
  projectRefs: [{ environmentId: env, projectId: projectId as ProjectId }],
});
const scopes = [scope("astrolabe", "astrolabe", "p1"), scope("branding", "branding", "p3")];

describe("the thread list's project menu", () => {
  it("lists the repositories under a heading", () => {
    expect(threadsProjectFilterOptions(scopes).map((option) => option.label)).toEqual([
      "Repositories",
      "astrolabe",
      "branding",
    ]);
    expect(threadsProjectFilterOptions([])).toEqual([]);
  });

  it("narrows the heading to every repository, as one scope", () => {
    const repositories = findThreadsProjectScope(
      scopes,
      REPOSITORIES_SCOPE_KEY,
      findHomeProjectScope,
    );
    expect(repositories?.projectRefs.map((ref) => ref.projectId)).toEqual(["p1", "p3"]);
    expect(repositories?.title).toBe("your repositories");
  });

  it("finds one repository, and leaves All projects unscoped", () => {
    expect(findThreadsProjectScope(scopes, "branding", findHomeProjectScope)?.title).toBe(
      "branding",
    );
    expect(findThreadsProjectScope(scopes, null, findHomeProjectScope)).toBeNull();
    expect(findThreadsProjectScope([], REPOSITORIES_SCOPE_KEY, findHomeProjectScope)).toBeNull();
  });
});
