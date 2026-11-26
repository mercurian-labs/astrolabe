/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */

/** The filter every section's list shares: All projects, then each project. */
export type ProjectFilterChoice =
  | { readonly kind: "all" }
  | { readonly kind: "repository"; readonly key: string };

/** A repository as a section knows it, under the key its own scope keeps. */
export interface ProjectFilterRepository<Repository> {
  readonly key: string;
  readonly label: string;
  readonly repository: Repository;
}

export type ProjectFilterOption<Repository> =
  | {
      readonly value: string;
      readonly kind: "all";
      readonly label: string;
    }
  | {
      readonly value: string;
      readonly kind: "repository";
      readonly label: string;
      readonly repository: Repository;
    };

export const projectFilterValue = (choice: ProjectFilterChoice): string =>
  choice.kind === "all" ? "all" : `repository:${choice.key}`;

export const projectFilterChoice = (option: ProjectFilterOption<unknown>): ProjectFilterChoice =>
  option.kind === "all"
    ? { kind: "all" }
    : { kind: "repository", key: option.value.slice("repository:".length) };

export function projectFilterOptions<Repository>({
  repositories,
}: {
  readonly repositories: ReadonlyArray<ProjectFilterRepository<Repository>>;
}): ReadonlyArray<ProjectFilterOption<Repository>> {
  return [
    { value: "all", kind: "all", label: "All projects" },
    ...repositories.map(({ key, label, repository }): ProjectFilterOption<Repository> => ({
      value: projectFilterValue({ kind: "repository", key }),
      kind: "repository",
      label,
      repository,
    })),
  ];
}

/**
 * The options a search keeps. All projects heads the list only while the query is empty, as the
 * thread list's project filter has it, so it never outranks a match.
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
