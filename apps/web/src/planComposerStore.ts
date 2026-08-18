import type { PlanningModelSelection } from "@t3tools/contracts";
import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";

/**
 * What a plan's composer is holding but has not sent.
 *
 * Client-local by design (ADR 002 §5): an unsent message is not a fact about
 * the plan, it is a fact about this browser. Leave the planning space and come
 * back and it is still there, because it never went anywhere.
 *
 * Keyed by plan, not by window. Two tabs on one plan share the draft the way
 * they share a text file — the last keystroke wins, and neither is authoritative
 * over the other.
 *
 * Distinct from `planDraftStore`, which holds the *unborn* plan: that draft is
 * keyed by project and its send creates a plan. Different lifecycle, different
 * key, so they are different stores.
 */
export const PLAN_COMPOSER_DRAFTS_STORAGE_KEY = "mercurian:plan-composer-drafts:v1";

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
  /** A draft-only flip, scoped to the branch head where it was made. */
  readonly modelChoice?: {
    readonly directive: PlanningModelSelection;
    readonly atHead: string | null;
  };
}

export const EMPTY_PLAN_COMPOSER_DRAFT: PlanComposerDraft = { text: "", attachments: [] };

interface PersistedPlanComposerDrafts {
  readonly draftsByPlanId?: Record<string, PlanComposerDraft>;
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

function isModelChoice(value: unknown): value is NonNullable<PlanComposerDraft["modelChoice"]> {
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
    (draft.modelChoice === undefined || isModelChoice(draft.modelChoice))
  );
}

/** Text, attachments, and a model flip are each draft intent worth keeping. */
const isEmptyDraft = (draft: PlanComposerDraft) =>
  draft.text.length === 0 && draft.attachments.length === 0 && draft.modelChoice === undefined;

/** A flip only applies where it was made; another branch reads its history. */
export function modelChoiceForHead(
  draft: PlanComposerDraft,
  head: string | null,
): PlanningModelSelection | undefined {
  return draft.modelChoice?.atHead === head ? draft.modelChoice.directive : undefined;
}

/**
 * What a stored blob means, with anything unrecognizable dropped rather than
 * trusted. Storage is user-writable and version-skewed; a draft that will not
 * decode is a draft that was never there.
 */
export function parsePersistedDrafts(raw: string | null): Record<string, PlanComposerDraft> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PersistedPlanComposerDrafts;
    return Object.fromEntries(
      Object.entries(parsed.draftsByPlanId ?? {}).filter(
        (entry): entry is [string, PlanComposerDraft] => isDraft(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

/**
 * The drafts as storage should hold them: session-only images are dropped on
 * the way out rather than on the way in, so the composer keeps showing every
 * image it accepted and only a reload can lose one.
 */
export function toPersistableDrafts(
  draftsByPlanId: Readonly<Record<string, PlanComposerDraft>>,
): Record<string, PlanComposerDraft> {
  return Object.fromEntries(
    Object.entries(draftsByPlanId).map(([planId, draft]) => [
      planId,
      {
        text: draft.text,
        attachments: draft.attachments.filter((one) => one.persistable),
        ...(draft.modelChoice === undefined ? {} : { modelChoice: draft.modelChoice }),
      },
    ]),
  );
}

function readPersistedDrafts(): Record<string, PlanComposerDraft> {
  if (typeof window === "undefined") return {};
  return parsePersistedDrafts(window.localStorage.getItem(PLAN_COMPOSER_DRAFTS_STORAGE_KEY));
}

function persistDrafts(draftsByPlanId: Readonly<Record<string, PlanComposerDraft>>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PLAN_COMPOSER_DRAFTS_STORAGE_KEY,
      JSON.stringify({
        draftsByPlanId: toPersistableDrafts(draftsByPlanId),
      } satisfies PersistedPlanComposerDrafts),
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
const persistDebouncer = new Debouncer(persistDrafts, { wait: PERSIST_DEBOUNCE_MS });

interface PlanComposerStore {
  readonly draftsByPlanId: Record<string, PlanComposerDraft>;
  readonly setDraftText: (planId: string, text: string) => void;
  readonly addAttachments: (
    planId: string,
    attachments: ReadonlyArray<PlanComposerAttachment>,
  ) => void;
  readonly removeAttachment: (planId: string, localId: string) => void;
  readonly setModelChoice: (
    planId: string,
    directive: PlanningModelSelection,
    atHead: string | null,
  ) => void;
  /** What sending does: the message left, so the draft of it is gone. */
  readonly clearDraft: (planId: string) => void;
}

const withDraft = (
  state: PlanComposerStore,
  planId: string,
  next: (draft: PlanComposerDraft) => PlanComposerDraft,
) => {
  const draft = next(state.draftsByPlanId[planId] ?? EMPTY_PLAN_COMPOSER_DRAFT);
  if (isEmptyDraft(draft)) {
    if (state.draftsByPlanId[planId] === undefined) return state;
    const { [planId]: _removed, ...rest } = state.draftsByPlanId;
    return { draftsByPlanId: rest };
  }
  return { draftsByPlanId: { ...state.draftsByPlanId, [planId]: draft } };
};

export const usePlanComposerStore = create<PlanComposerStore>((set) => ({
  draftsByPlanId: readPersistedDrafts(),
  setDraftText: (planId, text) =>
    set((state) =>
      state.draftsByPlanId[planId]?.text === text
        ? state
        : withDraft(state, planId, (draft) => ({ ...draft, text })),
    ),
  addAttachments: (planId, attachments) =>
    set((state) =>
      attachments.length === 0
        ? state
        : withDraft(state, planId, (draft) => ({
            ...draft,
            attachments: [...draft.attachments, ...attachments],
          })),
    ),
  removeAttachment: (planId, localId) =>
    set((state) =>
      withDraft(state, planId, (draft) => ({
        ...draft,
        attachments: draft.attachments.filter((one) => one.localId !== localId),
      })),
    ),
  setModelChoice: (planId, directive, atHead) =>
    set((state) =>
      withDraft(state, planId, (draft) => ({
        ...draft,
        modelChoice: { directive, atHead },
      })),
    ),
  clearDraft: (planId) =>
    set((state) => {
      if (state.draftsByPlanId[planId] === undefined) return state;
      const { [planId]: _removed, ...rest } = state.draftsByPlanId;
      return { draftsByPlanId: rest };
    }),
}));

usePlanComposerStore.subscribe((state) => persistDebouncer.maybeExecute(state.draftsByPlanId));

// Closing the tab is the one moment that cannot wait for the debounce.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => persistDebouncer.flush());
}
