import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";

import { wikiScopeKey } from "../wiki/wikiTabs";
import { storedName } from "./storedChoice";

/**
 * The filter every section's list shares: All, then each project, then each wiki. A list holding
 * both splits them under Projects and Wikis, the headings meaning every one of that kind.
 */
export type ProjectFilterChoice =
  | { readonly kind: "all" }
  | { readonly kind: "repositories" }
  | { readonly kind: "repository"; readonly key: string }
  | { readonly kind: "wikis" }
  | { readonly kind: "wiki"; readonly key: string };

/** A repository as a section knows it, under the key its own scope keeps. */
export interface ProjectFilterRepository<Repository> {
  readonly key: string;
  readonly label: string;
  readonly repository: Repository;
}

export type ProjectFilterOption<Repository> =
  | {
      readonly value: string;
      readonly kind: "all" | "repositories" | "wikis";
      readonly label: string;
    }
  | {
      readonly value: string;
      readonly kind: "repository";
      readonly label: string;
      readonly repository: Repository;
    }
  | {
      readonly value: string;
      readonly kind: "wiki";
      readonly label: string;
      readonly overview: WikiOverview;
    };

export const projectFilterValue = (choice: ProjectFilterChoice): string => {
  switch (choice.kind) {
    case "all":
    case "repositories":
    case "wikis":
      return choice.kind;
    case "repository":
      return `repository:${choice.key}`;
    case "wiki":
      return `wiki:${choice.key}`;
  }
};

export const projectFilterChoice = (option: ProjectFilterOption<unknown>): ProjectFilterChoice => {
  switch (option.kind) {
    case "all":
    case "repositories":
    case "wikis":
      return { kind: option.kind };
    case "repository":
      return { kind: "repository", key: option.value.slice("repository:".length) };
    case "wiki":
      return { kind: "wiki", key: option.value.slice("wiki:".length) };
  }
};

export function projectFilterOptions<Repository>({
  repositories,
  wikis,
}: {
  readonly repositories: ReadonlyArray<ProjectFilterRepository<Repository>>;
  readonly wikis: ReadonlyArray<WikiOverview>;
}): ReadonlyArray<ProjectFilterOption<Repository>> {
  const repositoryOptions = repositories.map(
    ({ key, label, repository }): ProjectFilterOption<Repository> => ({
      value: projectFilterValue({ kind: "repository", key }),
      kind: "repository",
      label,
      repository,
    }),
  );
  const wikiOptions = wikis.map((overview): ProjectFilterOption<Repository> => ({
    value: projectFilterValue({
      kind: "wiki",
      key: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
    }),
    kind: "wiki",
    label: overview.wiki.name,
    overview,
  }));
  if (repositoryOptions.length > 0 && wikiOptions.length > 0) {
    return [
      { value: "all", kind: "all", label: "All" },
      { value: "repositories", kind: "repositories", label: "Projects" },
      ...repositoryOptions,
      { value: "wikis", kind: "wikis", label: "Wikis" },
      ...wikiOptions,
    ];
  }
  const allLabel = wikiOptions.length > 0 ? "All wikis" : "All projects";
  return [{ value: "all", kind: "all", label: allLabel }, ...repositoryOptions, ...wikiOptions];
}

/**
 * The options a search keeps. All projects heads the list only while the query is empty, as the
 * thread list's project filter has it, so it never outranks a match; the headings stay
 * searchable, since "wikis" finding every wiki is what it says.
 */
export function searchProjectFilterOptions<Option extends { readonly kind: string }>(
  options: ReadonlyArray<Option>,
  query: string,
  matches: (option: Option, query: string) => boolean,
): ReadonlyArray<Option> {
  const trimmed = query.trim();
  if (trimmed === "") return options;
  return options.filter((option) => option.kind !== "all" && matches(option, trimmed));
}

/**
 * Which kind of project a section's list is narrowed to when no one project is picked: all,
 * every repository, or every wiki. Each section keeps its own, beside the project it picked.
 */
export const projectKindStore = (storageKey: string) =>
  storedName(storageKey, ["all", "repositories", "wikis"] as const);

export type ProjectKind = "all" | "repositories" | "wikis";
