import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";

import { wikiScopeKey } from "../wiki/wikiTabs";
import { storedName } from "./storedChoice";

/**
 * Astrolabe: the project filter every section's list shares. A project is a repository or a
 * wiki, so the filter lists All projects, then Repositories and each repository, then Wikis and
 * each wiki. The two headings are choices too, meaning every project of that kind. A wiki's
 * checkout is a project in T3 Code's sense; it is listed once, as the wiki. A section that lists
 * one kind offers only that kind, its heading standing for all of them.
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

export type ProjectFilterKinds = "both" | "repositories" | "wikis";

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

/** The `environmentId:projectId` keys of the wikis' checkouts. */
export function wikiCheckoutKeys(overviews: ReadonlyArray<WikiOverview>): ReadonlySet<string> {
  return new Set(
    overviews.flatMap((overview) =>
      overview.wiki.projectId === null
        ? []
        : [`${overview.environmentId}:${overview.wiki.projectId}`],
    ),
  );
}

export function projectFilterOptions<Repository>({
  repositories,
  wikis,
  kinds = "both",
}: {
  readonly repositories: ReadonlyArray<ProjectFilterRepository<Repository>>;
  readonly wikis: ReadonlyArray<WikiOverview>;
  readonly kinds?: ProjectFilterKinds;
}): ReadonlyArray<ProjectFilterOption<Repository>> {
  const options: ProjectFilterOption<Repository>[] = [];
  if (kinds === "both") options.push({ value: "all", kind: "all", label: "All projects" });
  if (kinds !== "wikis" && (repositories.length > 0 || kinds === "repositories")) {
    options.push({ value: "repositories", kind: "repositories", label: "Repositories" });
    for (const { key, label, repository } of repositories) {
      options.push({
        value: projectFilterValue({ kind: "repository", key }),
        kind: "repository",
        label,
        repository,
      });
    }
  }
  if (kinds !== "repositories" && (wikis.length > 0 || kinds === "wikis")) {
    options.push({ value: "wikis", kind: "wikis", label: "Wikis" });
    for (const overview of wikis) {
      options.push({
        value: projectFilterValue({
          kind: "wiki",
          key: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
        }),
        kind: "wiki",
        label: overview.wiki.name,
        overview,
      });
    }
  }
  return options;
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
