import { describe, expect, it } from "vite-plus/test";

import {
  projectFilterChoice,
  projectFilterOptions,
  projectFilterValue,
  searchProjectFilterOptions,
} from "./projectFilter";

const repository = (key: string, label: string) => ({ key, label, repository: { key } });
const contains = (option: { readonly label: string }, query: string) =>
  option.label.toLowerCase().includes(query.toLowerCase());

describe("the project filter", () => {
  it("lists All projects, then each project", () => {
    const options = projectFilterOptions({
      repositories: [repository("r1", "astrolabe"), repository("r2", "memory-tools")],
    });
    expect(options.map((option) => [option.kind, option.label])).toEqual([
      ["all", "All projects"],
      ["repository", "astrolabe"],
      ["repository", "memory-tools"],
    ]);
  });

  it("reads an option back as the choice it makes", () => {
    const options = projectFilterOptions({
      repositories: [repository("env-1:p1", "astrolabe")],
    });
    const choices = options.map(projectFilterChoice);
    expect(choices).toContainEqual({ kind: "repository", key: "env-1:p1" });
    expect(choices.map(projectFilterValue)).toEqual(options.map((option) => option.value));
  });

  it("drops All projects from a search", () => {
    const options = projectFilterOptions({
      repositories: [repository("r1", "astrolabe"), repository("r2", "memory-tools")],
    });
    expect(searchProjectFilterOptions(options, "astro", contains).map((o) => o.label)).toEqual([
      "astrolabe",
    ]);
    expect(searchProjectFilterOptions(options, "  ", contains)).toBe(options);
  });
});
