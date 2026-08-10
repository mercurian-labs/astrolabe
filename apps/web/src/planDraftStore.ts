import { create } from "zustand";

/**
 * Plan drafts: the only place an unborn plan exists.
 *
 * A plan is born when its first message lands as the root commit, so before
 * that there is nothing on the server and no row in the tree — just this
 * client-local blob and the composer rendering it. Abandoning a draft leaves
 * exactly this behind, which is why a plan you never messaged never existed.
 *
 * One reusable draft per project, mirroring the fork's new-thread behavior: a
 * second click on the same project picks the draft back up rather than
 * scattering duplicates.
 */
export const PLAN_DRAFTS_STORAGE_KEY = "t3code:plan-drafts:v1";

export interface PlanDraft {
  readonly draftId: string;
  readonly projectId: string;
  readonly text: string;
  readonly createdAt: string;
}

interface PersistedPlanDrafts {
  readonly draftsById?: Record<string, PlanDraft>;
}

function isPlanDraft(value: unknown): value is PlanDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PlanDraft>;
  return (
    typeof draft.draftId === "string" &&
    draft.draftId.length > 0 &&
    typeof draft.projectId === "string" &&
    draft.projectId.length > 0 &&
    typeof draft.text === "string" &&
    typeof draft.createdAt === "string"
  );
}

function readPersistedDrafts(): Record<string, PlanDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PLAN_DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedPlanDrafts;
    return Object.fromEntries(
      Object.entries(parsed.draftsById ?? {}).filter((entry): entry is [string, PlanDraft] =>
        isPlanDraft(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function persistDrafts(draftsById: Record<string, PlanDraft>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PLAN_DRAFTS_STORAGE_KEY,
      JSON.stringify({ draftsById } satisfies PersistedPlanDrafts),
    );
  } catch {
    // Storage errors must never block composing.
  }
}

export function findDraftForProject(
  draftsById: Readonly<Record<string, PlanDraft>>,
  projectId: string,
): PlanDraft | null {
  return Object.values(draftsById).find((draft) => draft.projectId === projectId) ?? null;
}

interface PlanDraftStore {
  readonly draftsById: Record<string, PlanDraft>;
  /** Returns the project's existing draft, or opens one. */
  readonly openDraftForProject: (
    projectId: string,
    draftId: string,
    createdAt: string,
  ) => PlanDraft;
  readonly setDraftText: (draftId: string, text: string) => void;
  readonly discardDraft: (draftId: string) => void;
}

export const usePlanDraftStore = create<PlanDraftStore>((set, get) => ({
  draftsById: readPersistedDrafts(),
  openDraftForProject: (projectId, draftId, createdAt) => {
    const existing = findDraftForProject(get().draftsById, projectId);
    if (existing !== null) {
      return existing;
    }
    const draft: PlanDraft = { draftId, projectId, text: "", createdAt };
    set((state) => ({ draftsById: { ...state.draftsById, [draftId]: draft } }));
    return draft;
  },
  setDraftText: (draftId, text) =>
    set((state) => {
      const draft = state.draftsById[draftId];
      if (draft === undefined || draft.text === text) {
        return state;
      }
      return { draftsById: { ...state.draftsById, [draftId]: { ...draft, text } } };
    }),
  discardDraft: (draftId) =>
    set((state) => {
      if (state.draftsById[draftId] === undefined) {
        return state;
      }
      const { [draftId]: _removed, ...rest } = state.draftsById;
      return { draftsById: rest };
    }),
}));

usePlanDraftStore.subscribe((state) => persistDrafts(state.draftsById));
