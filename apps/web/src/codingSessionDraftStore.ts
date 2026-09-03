import type { ModelSelection } from "@t3tools/contracts";
import { create } from "zustand";

export const CODING_SESSION_DRAFTS_STORAGE_KEY = "t3code:coding-session-drafts:v2";

export interface CodingSessionDraft {
  readonly draftId: string;
  readonly planId: string;
  readonly parentCommitId: string;
  readonly runtimeMode: "approval-required" | "auto-accept-edits" | "full-access";
  readonly modelSelection: ModelSelection;
  readonly createdAt: string;
}

interface PersistedCodingSessionDrafts {
  readonly draftsById?: Record<string, CodingSessionDraft>;
  readonly lastModelSelection?: ModelSelection;
}

const isModelSelection = (value: unknown): value is ModelSelection => {
  if (!value || typeof value !== "object") return false;
  const selection = value as { readonly instanceId?: unknown; readonly model?: unknown };
  return (
    typeof selection.instanceId === "string" &&
    selection.instanceId.length > 0 &&
    typeof selection.model === "string" &&
    selection.model.trim().length > 0
  );
};

const isDraft = (value: unknown): value is CodingSessionDraft => {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<CodingSessionDraft>;
  return (
    typeof draft.draftId === "string" &&
    typeof draft.planId === "string" &&
    typeof draft.parentCommitId === "string" &&
    (draft.runtimeMode === "approval-required" ||
      draft.runtimeMode === "auto-accept-edits" ||
      draft.runtimeMode === "full-access") &&
    isModelSelection(draft.modelSelection) &&
    typeof draft.createdAt === "string"
  );
};

export function decodeCodingSessionDraftStorage(
  value: string | null,
): PersistedCodingSessionDrafts {
  try {
    const parsed = JSON.parse(value ?? "{}") as PersistedCodingSessionDrafts;
    return {
      draftsById: Object.fromEntries(
        Object.entries(parsed.draftsById ?? {}).filter(
          (entry): entry is [string, CodingSessionDraft] => isDraft(entry[1]),
        ),
      ),
      ...(isModelSelection(parsed.lastModelSelection)
        ? { lastModelSelection: parsed.lastModelSelection }
        : {}),
    };
  } catch {
    return {};
  }
}

function readPersisted(): PersistedCodingSessionDrafts {
  return typeof window === "undefined"
    ? {}
    : decodeCodingSessionDraftStorage(
        window.localStorage.getItem(CODING_SESSION_DRAFTS_STORAGE_KEY),
      );
}

function persist(state: PersistedCodingSessionDrafts): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CODING_SESSION_DRAFTS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Draft persistence is helpful, never a reason to block the user.
  }
}

export const codingSessionDraftKey = (planId: string, parentCommitId: string) =>
  `${planId}:${parentCommitId}`;

export function findCodingSessionDraft(
  draftsById: Readonly<Record<string, CodingSessionDraft>>,
  planId: string,
  parentCommitId: string,
): CodingSessionDraft | null {
  return (
    Object.values(draftsById).find(
      (draft) => draft.planId === planId && draft.parentCommitId === parentCommitId,
    ) ?? null
  );
}

interface CodingSessionDraftStore {
  readonly draftsById: Record<string, CodingSessionDraft>;
  readonly lastModelSelection?: ModelSelection;
  readonly openDraft: (draft: CodingSessionDraft) => CodingSessionDraft;
  readonly updateDraft: (
    draftId: string,
    patch: Partial<Pick<CodingSessionDraft, "runtimeMode" | "modelSelection">>,
  ) => void;
  readonly completeStart: (draftId: string) => void;
  readonly discardDraft: (draftId: string) => void;
  readonly pruneMissingPlans: (planIds: ReadonlySet<string>) => void;
}

const initial = readPersisted();
export const useCodingSessionDraftStore = create<CodingSessionDraftStore>((set, get) => ({
  draftsById: initial.draftsById ?? {},
  ...(initial.lastModelSelection === undefined
    ? {}
    : { lastModelSelection: initial.lastModelSelection }),
  openDraft: (draft) => {
    const existing = findCodingSessionDraft(get().draftsById, draft.planId, draft.parentCommitId);
    if (existing !== null) return existing;
    set((state) => ({ draftsById: { ...state.draftsById, [draft.draftId]: draft } }));
    return draft;
  },
  updateDraft: (draftId, patch) =>
    set((state) => {
      const draft = state.draftsById[draftId];
      return draft === undefined
        ? state
        : { draftsById: { ...state.draftsById, [draftId]: { ...draft, ...patch } } };
    }),
  completeStart: (draftId) =>
    set((state) => {
      const draft = state.draftsById[draftId];
      if (draft === undefined) return state;
      const { [draftId]: _removed, ...draftsById } = state.draftsById;
      return { draftsById, lastModelSelection: draft.modelSelection };
    }),
  discardDraft: (draftId) =>
    set((state) => {
      if (state.draftsById[draftId] === undefined) return state;
      const { [draftId]: _removed, ...draftsById } = state.draftsById;
      return { draftsById };
    }),
  pruneMissingPlans: (planIds) =>
    set((state) => {
      const draftsById = Object.fromEntries(
        Object.entries(state.draftsById).filter(([, draft]) => planIds.has(draft.planId)),
      );
      return Object.keys(draftsById).length === Object.keys(state.draftsById).length
        ? state
        : { draftsById };
    }),
}));

useCodingSessionDraftStore.subscribe((state) =>
  persist({
    draftsById: state.draftsById,
    ...(state.lastModelSelection === undefined
      ? {}
      : { lastModelSelection: state.lastModelSelection }),
  }),
);
