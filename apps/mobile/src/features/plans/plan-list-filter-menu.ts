import { sortProjectsForTree } from "@t3tools/client-runtime/state/plan-listing";
import type { EnvironmentId, MercurianProject } from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";

export interface PlanListFilterEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

const checked = (value: boolean) => (value ? ("on" as const) : undefined);

export function buildPlanListFilterMenu(input: {
  readonly environments: ReadonlyArray<PlanListFilterEnvironment>;
  readonly projects: ReadonlyArray<MercurianProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectId: string | null;
}): MenuAction[] {
  return [
    ...(input.environments.length > 1
      ? [
          {
            id: "workspace",
            title: "Workspace",
            subactions: input.environments.map((environment) => ({
              id: `workspace:${environment.environmentId}`,
              title: environment.label,
              state: checked(input.selectedEnvironmentId === environment.environmentId),
            })),
          } satisfies MenuAction,
        ]
      : []),
    {
      id: "project",
      title: "Project",
      subactions: [
        {
          id: "project:all",
          title: "All projects",
          state: checked(input.selectedProjectId === null),
        },
        ...sortProjectsForTree(input.projects).map((project) => ({
          id: `project:${project.projectId}`,
          title: project.name,
          state: checked(input.selectedProjectId === project.projectId),
        })),
      ],
    },
  ];
}
