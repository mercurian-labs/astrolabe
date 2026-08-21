import type { PlanningModelSelection } from "@t3tools/contracts";
import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";

/**
 * What a plan's composer is holding but has not sent — per branch position.
 *
 * Client-local by design (ADR 002 §5): an unsent message is not a fact about
 * the plan, it is a fact about this browser. Leave the planning space and come
 * back and it is still there, because it never went anywhere.
 *
 * Keyed by plan and by the head commit the draft was composed at, not by
 * window. A draft is a reply written *somewhere*: switching branches shows
 * that branch's own draft, never another's. Two tabs standing on one branch
 * share its draft the way they share a text file — the last keystroke wins,
 * and neither is authoritative over the other.
 *
 * A draft composed while standing live at a branch tip rides the branch as it
 * grows ({@link followGrowth}); one composed looking back — an edit-and-branch
 * staging, or typing at an earlier checkpoint — waits at the fork it would
 * open. Liveness is recorded at write time because it is not derivable later:
 * the moment a child lands is the moment the two kinds must part ways.
 *
 * Distinct from `planDraftStore`, which holds the *unborn* plan: that draft is
 * keyed by project and its send creates a plan. Different lifecycle, different
 * key, so they are different stores.
 */
export const PLAN_COMPOSER_DRAFTS_STORAGE_KEY = "mercurian:plan-composer-drafts:v2";
/** The pre-branch-scoped blob; read once into `legacyByPlanId`, then removed. */
export const PLAN_COMPOSER_DRAFTS_LEGACY_STORAGE_KEY = "mercurian:plan-composer-drafts:v1";

export interface PlanComposerAttachment {
  /** Client-local, for keying the chip row and removing one. */
  readonly localId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl: string;
  /**
   * `false` when the image was too large to compress into the persisted
   * draft. It stays in the composer for this session and sends normally — it
   * just will not be there after a reload. Refusing to hold it at all would
   * be a worse trade than losing it on a reload nobody performed.
   */
  readonly persistable: boolean;
}

export interface PlanComposerDraft {
  readonly text: string;
  readonly attachments: ReadonlyArray<PlanComposerAttachment>;
  /** Composed while standing live at a branch tip — rides the branch forward. */
  readonly live: boolean;
  /**
   * A draft-only model flip. The head it applies at is the slot's own key;
   * riding forward strips it, preserving "a flip only applies where it was
   * made."
   */
  readonly modelChoice?: PlanningModelSelection;
}

export const EMPTY_PLAN_COMPOSER_DRAFT: PlanComposerDraft = {
  text: "",
  attachments: [],
  live: true,
};

/** The v1 shape: one draft per plan, the flip carrying its own head scope. */
interface LegacyPlanComposerDraft {
  readonly text: string;
  readonly attachments: ReadonlyArray<PlanComposerAttachment>;
  readonly modelChoice?: {
    readonly directive: PlanningModelSelection;
    readonly atHead: string | null;
  };
}

type DraftsByPlan = Record<string, Record<string, PlanComposerDraft>>;
type LegacyByPlanId = Record<string, LegacyPlanComposerDraft>;

interface PersistedPlanComposerState {
  readonly draftsByPlan?: DraftsByPlan;
  readonly legacyByPlanId?: LegacyByPlanId;
}

interface PersistedLegacyPlanComposerDrafts {
  readonly draftsByPlanId?: Record<string, LegacyPlanComposerDraft>;
}

function isAttachment(value: unknown): value is PlanComposerAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<PlanComposerAttachment>;
  return (
    typeof attachment.localId === "string" &&
    attachment.localId.length > 0 &&
    typeof attachment.name === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.sizeBytes === "number" &&
    typeof attachment.dataUrl === "string" &&
    attachment.dataUrl.length > 0
  );
}

function isModelSelection(value: unknown): value is PlanningModelSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as { readonly provider?: unknown; readonly model?: unknown };
  return (
    typeof selection.provider === "string" &&
    selection.provider.length > 0 &&
    typeof selection.model === "string" &&
    selection.model.trim().length > 0
  );
}

function isLegacyModelChoice(
  value: unknown,
): value is NonNullable<LegacyPlanComposerDraft["modelChoice"]> {
  if (!value || typeof value !== "object") return false;
  const choice = value as {
    readonly directive?: unknown;
    readonly atHead?: unknown;
  };
  return (
    isModelSelection(choice.directive) &&
    (choice.atHead === null || typeof choice.atHead === "string")
  );
}

function isDraft(value: unknown): value is PlanComposerDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PlanComposerDraft>;
  return (
    typeof draft.text === "string" &&
    Array.isArray(draft.attachments) &&
    draft.attachments.every(isAttachment) &&
    typeof draft.live === "boolean" &&
    (draft.modelChoice === undefined || isModelSelection(draft.modelChoice))
  );
}

function isLegacyDraft(value: unknown): value is LegacyPlanComposerDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<LegacyPlanComposerDraft>;
  return (
    typeof draft.text === "string" &&
    Array.isArray(draft.attachments) &&
    draft.attachments.every(isAttachment) &&
    (draft.modelChoice === undefined || isLegacyModelChoice(draft.modelChoice))
  );
}

/** Text, attachments, and a model flip are each draft intent worth keeping. */
const isEmptyDraft = (draft: PlanComposerDraft) =>
  draft.text.length === 0 && draft.attachments.length === 0 && draft.modelChoice === undefined;

/**
 * What a stored blob means, with anything unrecognizable dropped rather than
 * trusted. Storage is user-writable and version-skewed; a draft that will not
 * decode is a draft that was never there.
 */
export function parsePersistedState(raw: string | null): {
  draftsByPlan: DraftsByPlan;
  legacyByPlanId: LegacyByPlanId;
} {
  if (!raw) return { draftsByPlan: {}, legacyByPlanId: {} };
  try {
    const parsed = JSON.parse(raw) as PersistedPlanComposerState;
    const draftsByPlan: DraftsByPlan = {};
    for (const [planId, byHead] of Object.entries(parsed.draftsByPlan ?? {})) {
      if (!byHead || typeof byHead !== "object") continue;
      const kept = Object.fromEntries(
        Object.entries(byHead).filter((entry): entry is [string, PlanComposerDraft] =>
          isDraft(entry[1]),
        ),
      );
      if (Object.keys(kept).length > 0) draftsByPlan[planId] = kept;
    }
    const legacyByPlanId = Object.fromEntries(
      Object.entries(parsed.legacyByPlanId ?? {}).filter(
        (entry): entry is [string, LegacyPlanComposerDraft] => isLegacyDraft(entry[1]),
      ),
    );
    return { draftsByPlan, legacyByPlanId };
  } catch {
    return { draftsByPlan: {}, legacyByPlanId: {} };
  }
}

/** The v1 blob, read only to carry its drafts into `legacyByPlanId`. */
export function parseLegacyDrafts(raw: string | null): LegacyByPlanId {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PersistedLegacyPlanComposerDrafts;
    return Object.fromEntries(
      Object.entries(parsed.draftsByPlanId ?? {}).filter(
        (entry): entry is [string, LegacyPlanComposerDraft] => isLegacyDraft(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

/**
 * The state as storage should hold it: session-only images are dropped on
 * the way out rather than on the way in, so the composer keeps showing every
 * image it accepted and only a reload can lose one. Unadopted legacy drafts
 * persist too — they wait for their plan to be opened.
 */
export function toPersistableState(
  draftsByPlan: Readonly<DraftsByPlan>,
  legacyByPlanId: Readonly<LegacyByPlanId>,
): PersistedPlanComposerState {
  const persistable: DraftsByPlan = {};
  for (const [planId, byHead] of Object.entries(draftsByPlan)) {
    persistable[planId] = Object.fromEntries(
      Object.entries(byHead).map(([headId, draft]) => [
        headId,
        {
          text: draft.text,
          attachments: draft.attachments.filter((one) => one.persistable),
          live: draft.live,
          ...(draft.modelChoice === undefined ? {} : { modelChoice: draft.modelChoice }),
        },
      ]),
    );
  }
  return {
    draftsByPlan: persistable,
    ...(Object.keys(legacyByPlanId).length === 0 ? {} : { legacyByPlanId }),
  };
}

function readPersistedState(): { draftsByPlan: DraftsByPlan; legacyByPlanId: LegacyByPlanId } {
  if (typeof window === "undefined") return { draftsByPlan: {}, legacyByPlanId: {} };
  const rawV2 = window.localStorage.getItem(PLAN_COMPOSER_DRAFTS_STORAGE_KEY);
  const state = parsePersistedState(rawV2);
  // One-shot v1 migration: its drafts become legacy entries, adopted onto a
  // real head the next time each plan's space is opened.
  const rawV1 = window.localStorage.getItem(PLAN_COMPOSER_DRAFTS_LEGACY_STORAGE_KEY);
  if (rawV1 !== null) {
    const legacy = parseLegacyDrafts(rawV1);
    state.legacyByPlanId = { ...legacy, ...state.legacyByPlanId };
    try {
      window.localStorage.setItem(
        PLAN_COMPOSER_DRAFTS_STORAGE_KEY,
        JSON.stringify(toPersistableState(state.draftsByPlan, state.legacyByPlanId)),
      );
      window.localStorage.removeItem(PLAN_COMPOSER_DRAFTS_LEGACY_STORAGE_KEY);
    } catch {
      // Storage errors must never block composing.
    }
  }
  return state;
}

function persistState(state: {
  draftsByPlan: Readonly<DraftsByPlan>;
  legacyByPlanId: Readonly<LegacyByPlanId>;
}): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PLAN_COMPOSER_DRAFTS_STORAGE_KEY,
      JSON.stringify(toPersistableState(state.draftsByPlan, state.legacyByPlanId)),
    );
  } catch {
    // Storage errors must never block composing.
  }
}

/**
 * The serialization is inside the debounce, not just the write.
 *
 * A draft holds images as data URLs, so `JSON.stringify` over it is megabytes
 * of work; doing that on every keystroke is exactly the kind of thing our users
 * feel as a dropped frame. Typing costs nothing until it stops.
 */
const PERSIST_DEBOUNCE_MS = 300;
const persistDebouncer = new Debouncer(persistState, { wait: PERSIST_DEBOUNCE_MS });

interface PlanComposerStore {
  readonly draftsByPlan: DraftsByPlan;
  readonly legacyByPlanId: LegacyByPlanId;
  readonly setDraftText: (planId: string, headId: string, text: string, live: boolean) => void;
  readonly addAttachments: (
    planId: string,
    headId: string,
    attachments: ReadonlyArray<PlanComposerAttachment>,
    live: boolean,
  ) => void;
  readonly removeAttachment: (planId: string, headId: string, localId: string) => void;
  readonly setModelChoice: (
    planId: string,
    headId: string,
    directive: PlanningModelSelection,
    live: boolean,
  ) => void;
  /** What sending does: the message left, so the draft of it is gone. */
  readonly clearDraft: (planId: string, headId: string) => void;
  /**
   * The branch grew; live drafts ride it. `resolve` answers where a draft's
   * head now stands (the surface derives it from the graph the way a live
   * position advances); `null` or the same head means stay. A move strips the
   * model flip — it only applied where it was made — and a move whose
   * destination already holds a draft yields to it: the standing draft was
   * composed *at* that head and is the fresher intent. Idempotent, so every
   * window racing the same growth converges.
   */
  readonly followGrowth: (planId: string, resolve: (headId: string) => string | null) => void;
  /**
   * A pre-branch-scoped draft meets its first known head: the plan's legacy
   * draft (if any) becomes that head's draft, keeping its flip only when the
   * flip was scoped to this very head. A head that already holds a draft
   * wins; the legacy entry is spent either way.
   */
  readonly adoptLegacyDraft: (planId: string, headId: string) => void;
}

const withDraft = (
  state: PlanComposerStore,
  planId: string,
  headId: string,
  live: boolean,
  next: (draft: PlanComposerDraft) => PlanComposerDraft,
) => {
  const byHead = state.draftsByPlan[planId] ?? {};
  const existing = byHead[headId];
  const draft = next(existing ?? { ...EMPTY_PLAN_COMPOSER_DRAFT, live });
  if (isEmptyDraft(draft)) {
    if (existing === undefined) return state;
    const { [headId]: _removed, ...restHeads } = byHead;
    if (Object.keys(restHeads).length > 0) {
      return { draftsByPlan: { ...state.draftsByPlan, [planId]: restHeads } };
    }
    const { [planId]: _removedPlan, ...restPlans } = state.draftsByPlan;
    return { draftsByPlan: restPlans };
  }
  return {
    draftsByPlan: { ...state.draftsByPlan, [planId]: { ...byHead, [headId]: draft } },
  };
};

export const usePlanComposerStore = create<PlanComposerStore>((set) => ({
  ...readPersistedState(),
  setDraftText: (planId, headId, text, live) =>
    set((state) =>
      state.draftsByPlan[planId]?.[headId]?.text === text
        ? state
        : withDraft(state, planId, headId, live, (draft) => ({ ...draft, text })),
    ),
  addAttachments: (planId, headId, attachments, live) =>
    set((state) =>
      attachments.length === 0
        ? state
        : withDraft(state, planId, headId, live, (draft) => ({
            ...draft,
            attachments: [...draft.attachments, ...attachments],
          })),
    ),
  removeAttachment: (planId, headId, localId) =>
    set((state) =>
      state.draftsByPlan[planId]?.[headId] === undefined
        ? state
        : withDraft(state, planId, headId, true, (draft) => ({
            ...draft,
            attachments: draft.attachments.filter((one) => one.localId !== localId),
          })),
    ),
  setModelChoice: (planId, headId, directive, live) =>
    set((state) =>
      withDraft(state, planId, headId, live, (draft) => ({
        ...draft,
        modelChoice: directive,
      })),
    ),
  clearDraft: (planId, headId) =>
    set((state) => {
      const byHead = state.draftsByPlan[planId];
      if (byHead?.[headId] === undefined) return state;
      const { [headId]: _removed, ...restHeads } = byHead;
      if (Object.keys(restHeads).length > 0) {
        return { draftsByPlan: { ...state.draftsByPlan, [planId]: restHeads } };
      }
      const { [planId]: _removedPlan, ...restPlans } = state.draftsByPlan;
      return { draftsByPlan: restPlans };
    }),
  followGrowth: (planId, resolve) =>
    set((state) => {
      const byHead = state.draftsByPlan[planId];
      if (byHead === undefined) return state;
      let moved = false;
      const next: Record<string, PlanComposerDraft> = {};
      for (const [headId, draft] of Object.entries(byHead)) {
        if (!draft.live) {
          next[headId] = draft;
          continue;
        }
        const target = resolve(headId);
        if (target === null || target === headId) {
          next[headId] = draft;
          continue;
        }
        moved = true;
        if (byHead[target] !== undefined || next[target] !== undefined) continue;
        const { modelChoice: _stripped, ...rest } = draft;
        next[target] = rest;
      }
      if (!moved) return state;
      if (Object.keys(next).length === 0) {
        const { [planId]: _removedPlan, ...restPlans } = state.draftsByPlan;
        return { draftsByPlan: restPlans };
      }
      return { draftsByPlan: { ...state.draftsByPlan, [planId]: next } };
    }),
  adoptLegacyDraft: (planId, headId) =>
    set((state) => {
      const legacy = state.legacyByPlanId[planId];
      if (legacy === undefined) return state;
      const { [planId]: _spent, ...restLegacy } = state.legacyByPlanId;
      const byHead = state.draftsByPlan[planId] ?? {};
      if (byHead[headId] !== undefined) return { legacyByPlanId: restLegacy };
      const modelChoice =
        legacy.modelChoice !== undefined && legacy.modelChoice.atHead === headId
          ? legacy.modelChoice.directive
          : undefined;
      const adopted: PlanComposerDraft = {
        text: legacy.text,
        attachments: legacy.attachments,
        live: true,
        ...(modelChoice === undefined ? {} : { modelChoice }),
      };
      if (isEmptyDraft(adopted)) return { legacyByPlanId: restLegacy };
      return {
        legacyByPlanId: restLegacy,
        draftsByPlan: { ...state.draftsByPlan, [planId]: { ...byHead, [headId]: adopted } },
      };
    }),
}));

usePlanComposerStore.subscribe((state) =>
  persistDebouncer.maybeExecute({
    draftsByPlan: state.draftsByPlan,
    legacyByPlanId: state.legacyByPlanId,
  }),
);

// Closing the tab is the one moment that cannot wait for the debounce.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => persistDebouncer.flush());
}
