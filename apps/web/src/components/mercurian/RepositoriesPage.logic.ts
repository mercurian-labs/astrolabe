/**
 * What the Repositories page decides before it renders anything.
 *
 * These read structural shapes rather than the wire types: everything here is
 * about presentation order and the words on a row, so nothing needs a schema.
 */

interface ScriptFields {
  readonly scriptId: string;
  readonly name: string;
  readonly command: string;
  readonly previewUrl?: string | undefined;
  readonly isSetup: boolean;
}

interface RepositoryFields {
  readonly repositoryId: string;
  readonly name: string;
  readonly path: string;
  readonly hasGit: boolean;
  readonly scripts: ReadonlyArray<ScriptFields>;
}

/**
 * What a repository row says when the directory is not a repository.
 *
 * The line is the whole affordance: there is no toggle and no rescan button,
 * because git-ness is probed rather than declared, and it starts being true
 * the moment the directory starts being a repository.
 */
export const NOT_A_GIT_REPOSITORY_NOTE =
  "Not a git repository — grounding reads its files. Worktrees, diffs, and coding sessions arrive when it is one.";

/** Alphabetical, because a management page is something you scan by name. */
export function sortRepositoriesForPage<T extends RepositoryFields>(
  repositories: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return repositories.toSorted((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

export interface ScriptDeclaration {
  readonly scriptId: string;
  readonly name: string;
  readonly command: string;
  /** Short words on the row: what the script is, not what it would do. */
  readonly badges: ReadonlyArray<string>;
}

/**
 * A script as the row shows it: name, command, and the two things a
 * declaration can say about itself. No run affordance — execution ships with
 * the session view, and a disabled Run button would promise it early.
 */
export function describeScriptDeclarations(
  scripts: ReadonlyArray<ScriptFields>,
): ReadonlyArray<ScriptDeclaration> {
  return scripts.map((script) => ({
    scriptId: script.scriptId,
    name: script.name,
    command: script.command,
    badges: [
      ...(script.isSetup ? ["setup"] : []),
      ...(script.previewUrl === undefined || script.previewUrl.trim().length === 0
        ? []
        : [`preview ${script.previewUrl}`]),
    ],
  }));
}

/** Which projects a repository is context for, by id. */
export function projectsForRepository<ProjectId extends string, RepositoryId extends string>(
  links: ReadonlyArray<{ readonly projectId: ProjectId; readonly repositoryId: RepositoryId }>,
  repositoryId: RepositoryId,
): ReadonlyArray<ProjectId> {
  return links.filter((link) => link.repositoryId === repositoryId).map((link) => link.projectId);
}

/** The set of repository ids a project is working in. */
export function repositoryIdsForProject<ProjectId extends string, RepositoryId extends string>(
  links: ReadonlyArray<{ readonly projectId: ProjectId; readonly repositoryId: RepositoryId }>,
  projectId: ProjectId,
): ReadonlySet<RepositoryId> {
  return new Set(
    links.filter((link) => link.projectId === projectId).map((link) => link.repositoryId),
  );
}
