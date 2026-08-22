import type { CodingSessionDraft } from "@t3tools/client-runtime/state/coding-session-draft";
import { useSyncExternalStore } from "react";

export type MobileCodingSessionDraftUpdate = Partial<
  Pick<CodingSessionDraft, "baseRef" | "startFromOrigin" | "runtimeMode" | "modelSelection">
>;

const drafts = new Map<string, CodingSessionDraft>();
const listeners = new Set<() => void>();

export const codingSessionDraftKey = (planId: string, parentCommitId: string): string =>
  `${planId}:${parentCommitId}`;

function emit(): void {
  for (const listener of listeners) listener();
}

export function findMobileCodingSessionDraft(
  planId: string,
  parentCommitId: string,
): CodingSessionDraft | null {
  return drafts.get(codingSessionDraftKey(planId, parentCommitId)) ?? null;
}

export function openMobileCodingSessionDraft(draft: CodingSessionDraft): CodingSessionDraft {
  const key = codingSessionDraftKey(draft.planId, draft.parentCommitId);
  const existing = drafts.get(key);
  if (existing !== undefined) return existing;
  drafts.set(key, draft);
  emit();
  return draft;
}

export function updateMobileCodingSessionDraft(
  planId: string,
  parentCommitId: string,
  update: MobileCodingSessionDraftUpdate,
): void {
  const key = codingSessionDraftKey(planId, parentCommitId);
  const current = drafts.get(key);
  if (current === undefined) return;
  drafts.set(key, { ...current, ...update });
  emit();
}

export function clearMobileCodingSessionDraft(planId: string, parentCommitId: string): void {
  if (drafts.delete(codingSessionDraftKey(planId, parentCommitId))) emit();
}

export function subscribeToMobileCodingSessionDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMobileCodingSessionDraft(
  planId: string,
  parentCommitId: string,
): CodingSessionDraft | null {
  return useSyncExternalStore(
    subscribeToMobileCodingSessionDrafts,
    () => findMobileCodingSessionDraft(planId, parentCommitId),
    () => findMobileCodingSessionDraft(planId, parentCommitId),
  );
}

export function resetMobileCodingSessionDraftsForTest(): void {
  drafts.clear();
  emit();
}
