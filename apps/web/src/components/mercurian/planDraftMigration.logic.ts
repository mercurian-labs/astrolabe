import type { MercurianProject, ModelSelection, ServerProvider } from "@t3tools/contracts";
import { resolvePlanningModel } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import type { PlanDraft } from "../../planDraftStore";

export interface PlanDraftMigration {
  readonly draft: PlanDraft;
  readonly orchestrationProjectId: NonNullable<MercurianProject["orchestrationProjectId"]>;
  readonly modelSelection: ModelSelection | null;
}

export function resolvePlanDraftMigrations(input: {
  readonly draftsById: Readonly<Record<string, PlanDraft>>;
  readonly projects: ReadonlyArray<MercurianProject>;
  readonly providers: ReadonlyArray<ServerProvider>;
}): ReadonlyArray<PlanDraftMigration> {
  const projectById = new Map(
    input.projects.map((project) => [String(project.projectId), project]),
  );
  return Object.values(input.draftsById).flatMap((draft) => {
    const project = projectById.get(draft.projectId);
    if (project?.orchestrationProjectId == null) return [];
    const modelResolution = resolvePlanningModel(draft.modelChoice ?? null, input.providers);
    return [
      {
        draft,
        orchestrationProjectId: project.orchestrationProjectId,
        modelSelection:
          modelResolution._tag === "resolved"
            ? createModelSelection(
                modelResolution.instanceId,
                modelResolution.model,
                draft.modelChoice?.options,
              )
            : null,
      },
    ];
  });
}
