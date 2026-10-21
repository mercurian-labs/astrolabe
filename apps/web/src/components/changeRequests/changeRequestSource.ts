import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { wikiScopeKey } from "../wiki/wikiTabs";

/**
 * Astrolabe: where the Change Requests list's change requests come from. The section narrows by
 * source, as Threads narrows by project and Wikis by wiki: every source, one project's pull
 * requests, every wiki's changes, or one wiki's.
 */
export type ChangeRequestSource =
  | { readonly kind: "all" }
  | {
      readonly kind: "project";
      readonly projectId: ProjectId;
      readonly environmentId: EnvironmentId;
    }
  | { readonly kind: "wikis" }
  | { readonly kind: "wiki"; readonly scope: string };

export interface SourceProject {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
}

export type ChangeRequestSourceOption<Project extends SourceProject> =
  | { readonly value: string; readonly kind: "all"; readonly label: string }
  | {
      readonly value: string;
      readonly kind: "project";
      readonly label: string;
      readonly project: Project;
    }
  | { readonly value: string; readonly kind: "wikis"; readonly label: string }
  | {
      readonly value: string;
      readonly kind: "wiki";
      readonly label: string;
      readonly overview: WikiOverview;
    };

export const sourceValue = (source: ChangeRequestSource): string => {
  switch (source.kind) {
    case "all":
      return "all";
    case "wikis":
      return "wikis";
    case "project":
      return `project:${source.environmentId}:${source.projectId}`;
    case "wiki":
      return `wiki:${source.scope}`;
  }
};

/**
 * The filter's choices: All, each project, then every wiki and each wiki. A wiki's folder is a
 * project too; it is listed once, as the wiki.
 */
export function changeRequestSourceOptions<Project extends SourceProject>(
  projects: ReadonlyArray<Project>,
  overviews: ReadonlyArray<WikiOverview>,
): ReadonlyArray<ChangeRequestSourceOption<Project>> {
  const wikiProjects = new Set(
    overviews.flatMap((overview) =>
      overview.wiki.projectId === null
        ? []
        : [`${overview.environmentId}:${overview.wiki.projectId}`],
    ),
  );
  return [
    { value: "all", kind: "all", label: "All" },
    ...projects
      .filter((project) => !wikiProjects.has(`${project.environmentId}:${project.id}`))
      .map((project) => ({
        value: sourceValue({
          kind: "project",
          projectId: project.id,
          environmentId: project.environmentId,
        }),
        kind: "project" as const,
        label: project.title,
        project,
      })),
    ...(overviews.length > 0
      ? [
          { value: "wikis", kind: "wikis" as const, label: "All wikis" },
          ...overviews.map((overview) => ({
            value: sourceValue({
              kind: "wiki",
              scope: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
            }),
            kind: "wiki" as const,
            label: overview.wiki.name,
            overview,
          })),
        ]
      : []),
  ];
}

/**
 * The source the section shows now: the list's project scope, else the wikis (one, when Wikis'
 * filter names one) once the kind switch says wikis, else every source.
 */
export function currentSource(input: {
  readonly wikisOnly: boolean;
  readonly projectId: ProjectId | undefined;
  readonly projectEnvironmentId: EnvironmentId | undefined;
  readonly wikiScope: string | null;
}): ChangeRequestSource {
  if (input.wikisOnly) {
    return input.wikiScope === null ? { kind: "wikis" } : { kind: "wiki", scope: input.wikiScope };
  }
  if (input.projectId !== undefined && input.projectEnvironmentId !== undefined) {
    return {
      kind: "project",
      projectId: input.projectId,
      environmentId: input.projectEnvironmentId,
    };
  }
  return { kind: "all" };
}
