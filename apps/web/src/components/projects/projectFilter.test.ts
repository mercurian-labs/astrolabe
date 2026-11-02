import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import type { EnvironmentId, WikiId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  projectFilterChoice,
  projectFilterOptions,
  projectFilterValue,
  searchProjectFilterOptions,
} from "./projectFilter";

const env = "env-1" as EnvironmentId;
const repository = (key: string, label: string) => ({ key, label, repository: { key } });
const overview = (wikiId: string, name: string) =>
  ({
    environmentId: env,
    wiki: { wikiId: wikiId as WikiId, name },
  }) as unknown as WikiOverview;
const contains = (option: { readonly label: string }, query: string) =>
  option.label.toLowerCase().includes(query.toLowerCase());

describe("the project filter", () => {
  it("lists All, the projects, then the wikis, each under its heading", () => {
    const options = projectFilterOptions({
      repositories: [repository("r1", "astrolabe"), repository("r2", "memory-tools")],
      wikis: [overview("w1", "Almagest")],
    });
    expect(options.map((option) => [option.kind, option.label])).toEqual([
      ["all", "All"],
      ["repositories", "Projects"],
      ["repository", "astrolabe"],
      ["repository", "memory-tools"],
      ["wikis", "Wikis"],
      ["wiki", "Almagest"],
    ]);
  });

  it("drops the headings from a list of one kind, its All naming that kind", () => {
    const projects = projectFilterOptions({
      repositories: [repository("r1", "astrolabe")],
      wikis: [],
    });
    expect(projects.map((option) => [option.kind, option.label])).toEqual([
      ["all", "All projects"],
      ["repository", "astrolabe"],
    ]);
    const wikis = projectFilterOptions({ repositories: [], wikis: [overview("w1", "Almagest")] });
    expect(wikis.map((option) => option.label)).toEqual(["All wikis", "Almagest"]);
  });

  it("reads an option back as the choice it makes", () => {
    const options = projectFilterOptions({
      repositories: [repository("env-1:p1", "astrolabe")],
      wikis: [overview("w1", "Almagest")],
    });
    const choices = options.map(projectFilterChoice);
    expect(choices).toContainEqual({ kind: "repository", key: "env-1:p1" });
    expect(choices.map(projectFilterValue)).toEqual(options.map((option) => option.value));
  });

  it("drops All projects from a search but keeps the headings searchable", () => {
    const options = projectFilterOptions({
      repositories: [repository("r1", "astrolabe")],
      wikis: [overview("w1", "Team wiki")],
    });
    expect(searchProjectFilterOptions(options, "wiki", contains).map((o) => o.label)).toEqual([
      "Wikis",
      "Team wiki",
    ]);
    expect(searchProjectFilterOptions(options, "  ", contains)).toBe(options);
  });
});
