import {
  PlanningModelSelection,
  resolvePlanningModel,
  type MercurianProject,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Schema from "effect/Schema";

export const LEGACY_PLAN_DRAFTS_STORAGE_KEY = "t3code:plan-drafts:v1";

export interface LegacyPlanDraft {
  readonly draftId: string;
  readonly projectId: string;
  readonly text: string;
  readonly createdAt: string;
  readonly modelChoice?: PlanningModelSelection;
}

interface PersistedLegacyPlanDrafts {
  readonly draftsById?: Record<string, unknown>;
}

const isPlanningModelSelection = Schema.is(PlanningModelSelection);

function isLegacyPlanDraft(value: unknown): value is LegacyPlanDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<LegacyPlanDraft>;
  return (
    typeof draft.draftId === "string" &&
    draft.draftId.length > 0 &&
    typeof draft.projectId === "string" &&
    draft.projectId.length > 0 &&
    typeof draft.text === "string" &&
    typeof draft.createdAt === "string" &&
    (draft.modelChoice === undefined || isPlanningModelSelection(draft.modelChoice))
  );
}

export function readLegacyPlanDrafts(
  storage: Pick<Storage, "getItem">,
): Record<string, LegacyPlanDraft> {
  try {
    const raw = storage.getItem(LEGACY_PLAN_DRAFTS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as PersistedLegacyPlanDrafts;
    return Object.fromEntries(
      Object.entries(parsed.draftsById ?? {}).filter(
        (entry): entry is [string, LegacyPlanDraft] =>
          isLegacyPlanDraft(entry[1]) && entry[0] === entry[1].draftId,
      ),
    );
  } catch {
    return {};
  }
}

export function removeMigratedLegacyPlanDrafts(
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem">,
  migratedDraftIds: ReadonlySet<string>,
): Record<string, LegacyPlanDraft> {
  const remaining = Object.fromEntries(
    Object.entries(readLegacyPlanDrafts(storage)).filter(
      ([draftId]) => !migratedDraftIds.has(draftId),
    ),
  );
  try {
    if (Object.keys(remaining).length === 0) {
      storage.removeItem(LEGACY_PLAN_DRAFTS_STORAGE_KEY);
    } else {
      storage.setItem(
        LEGACY_PLAN_DRAFTS_STORAGE_KEY,
        JSON.stringify({ draftsById: remaining } satisfies PersistedLegacyPlanDrafts),
      );
    }
  } catch {
    // Storage cleanup must never block the already-completed migration.
  }
  return remaining;
}

export interface PlanDraftMigration {
  readonly draft: LegacyPlanDraft;
  readonly orchestrationProjectId: NonNullable<MercurianProject["orchestrationProjectId"]>;
  readonly modelSelection: ModelSelection | null;
}

export function resolvePlanDraftMigrations(input: {
  readonly draftsById: Readonly<Record<string, LegacyPlanDraft>>;
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
