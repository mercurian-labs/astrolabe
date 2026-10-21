import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import type { EnvironmentId, ProjectId, WikiId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { changeRequestSourceOptions, currentSource, sourceValue } from "./changeRequestSource";

const env = "env-1" as EnvironmentId;
const project = (id: string, title: string) => ({
  id: id as ProjectId,
  environmentId: env,
  title,
});
const overview = (wikiId: string, name: string, projectId: string | null) =>
  ({
    environmentId: env,
    wiki: { wikiId: wikiId as WikiId, name, projectId },
  }) as unknown as WikiOverview;

describe("the Change Requests source filter", () => {
  it("lists All, the projects, then the wikis, each wiki once", () => {
    const options = changeRequestSourceOptions(
      [project("p1", "astrolabe"), project("p2", "almagest")],
      [overview("w1", "almagest", "p2")],
    );
    expect(options.map((option) => option.label)).toEqual([
      "All",
      "astrolabe",
      "All wikis",
      "almagest",
    ]);
  });

  it("leaves the wikis out when there are none", () => {
    expect(changeRequestSourceOptions([project("p1", "astrolabe")], []).map((o) => o.kind)).toEqual(
      ["all", "project"],
    );
  });

  it("reads the source the section shows now", () => {
    const projectId = "p1" as ProjectId;
    expect(
      currentSource({ wikisOnly: false, projectId, projectEnvironmentId: env, wikiScope: "x" }),
    ).toEqual({ kind: "project", projectId, environmentId: env });
    expect(
      currentSource({ wikisOnly: true, projectId, projectEnvironmentId: env, wikiScope: "x" }),
    ).toEqual({ kind: "wiki", scope: "x" });
    expect(
      sourceValue(
        currentSource({
          wikisOnly: true,
          projectId: undefined,
          projectEnvironmentId: undefined,
          wikiScope: null,
        }),
      ),
    ).toBe("wikis");
    expect(
      currentSource({
        wikisOnly: false,
        projectId: undefined,
        projectEnvironmentId: undefined,
        wikiScope: "x",
      }),
    ).toEqual({ kind: "all" });
  });
});
