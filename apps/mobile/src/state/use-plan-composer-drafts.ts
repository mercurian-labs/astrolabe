import { useAtomValue } from "@effect/atom-react";
import type { PlanDraftModelChoice } from "@t3tools/client-runtime/state/plan-composer";
import {
  PlanningModelSelection as PlanningModelSelectionSchema,
  type EnvironmentId,
  type PlanId,
  type PlanningModelSelection,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { SerializedAsyncQueue } from "../lib/serialized-async-queue";
import { appAtomRegistry } from "./atom-registry";

const SCHEMA_VERSION = 1;
const DIRECTORY = "plan-composer-drafts";
const FILE = "drafts.json";
const PERSIST_DEBOUNCE_MS = 200;

export interface PlanComposerDraft {
  readonly text: string;
  readonly modelChoice?: PlanDraftModelChoice;
}

const EMPTY_DRAFT: PlanComposerDraft = { text: "" };
const DraftSchema = Schema.Struct({
  text: Schema.String,
  modelChoice: Schema.optional(
    Schema.Struct({
      directive: PlanningModelSelectionSchema,
      atHead: Schema.NullOr(Schema.String),
    }),
  ),
});
const decodeDraft = Schema.decodeUnknownOption(DraftSchema);

export const planComposerDraftsAtom = Atom.make<Record<string, PlanComposerDraft>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:plan-composer-drafts"),
);

let loadPromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const persistenceQueue = new SerializedAsyncQueue();

export function planComposerDraftKey(environmentId: EnvironmentId, planId: PlanId): string {
  return `${environmentId}:${planId}`;
}

const isEmpty = (draft: PlanComposerDraft) =>
  draft.text.length === 0 && draft.modelChoice === undefined;

const normalized = (draft: PlanComposerDraft | undefined): PlanComposerDraft =>
  draft ?? EMPTY_DRAFT;

export function decodePersistedPlanComposerDrafts(
  value: unknown,
): Record<string, PlanComposerDraft> {
  if (!value || typeof value !== "object") return {};
  const document = value as { readonly schemaVersion?: unknown; readonly drafts?: unknown };
  if (
    document.schemaVersion !== SCHEMA_VERSION ||
    !document.drafts ||
    typeof document.drafts !== "object" ||
    Array.isArray(document.drafts)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(document.drafts).flatMap(([key, value]) => {
      const decoded = decodeDraft(value);
      return Option.isSome(decoded) && !isEmpty(decoded.value) ? [[key, decoded.value]] : [];
    }),
  );
}

export function setPlanComposerDraftTextState(
  current: Record<string, PlanComposerDraft>,
  key: string,
  text: string,
): Record<string, PlanComposerDraft> {
  return setDraft(current, key, { ...normalized(current[key]), text });
}

export function setPlanComposerDraftModelChoiceState(
  current: Record<string, PlanComposerDraft>,
  key: string,
  directive: PlanningModelSelection,
  atHead: string | null,
): Record<string, PlanComposerDraft> {
  return setDraft(current, key, {
    ...normalized(current[key]),
    modelChoice: { directive, atHead },
  });
}

export function clearPlanComposerDraftState(
  current: Record<string, PlanComposerDraft>,
  key: string,
): Record<string, PlanComposerDraft> {
  if (current[key] === undefined) return current;
  const next = { ...current };
  delete next[key];
  return next;
}

function setDraft(
  current: Record<string, PlanComposerDraft>,
  key: string,
  draft: PlanComposerDraft,
): Record<string, PlanComposerDraft> {
  if (isEmpty(draft)) return clearPlanComposerDraftState(current, key);
  return { ...current, [key]: draft };
}

export function removePlanComposerDraftsForEnvironment(
  current: Record<string, PlanComposerDraft>,
  environmentId: EnvironmentId,
): Record<string, PlanComposerDraft> {
  const prefix = `${environmentId}:`;
  return Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix)));
}

async function getDraftsFile() {
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return new File(directory, FILE);
}

async function readDrafts(): Promise<Record<string, PlanComposerDraft>> {
  try {
    const file = await getDraftsFile();
    if (!file.exists) return {};
    return decodePersistedPlanComposerDrafts(JSON.parse(await file.text()) as unknown);
  } catch (error) {
    console.warn("[plan-composer-drafts] ignored persisted draft failure", error);
    return {};
  }
}

async function writeDrafts(drafts: Record<string, PlanComposerDraft>): Promise<void> {
  const file = await getDraftsFile();
  if (!file.exists) file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify({ schemaVersion: SCHEMA_VERSION, drafts }));
}

function persist(drafts: Record<string, PlanComposerDraft>): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistenceQueue
      .run(() => writeDrafts(drafts))
      .catch((error) => {
        console.warn("[plan-composer-drafts] failed to persist drafts", error);
      });
  }, PERSIST_DEBOUNCE_MS);
}

function ensureLoaded(): void {
  if (loadPromise !== null) return;
  loadPromise = readDrafts().then((persisted) => {
    if (Object.keys(persisted).length === 0) return;
    const current = appAtomRegistry.get(planComposerDraftsAtom);
    appAtomRegistry.set(planComposerDraftsAtom, { ...persisted, ...current });
  });
}

function update(
  transform: (current: Record<string, PlanComposerDraft>) => Record<string, PlanComposerDraft>,
): void {
  const next = transform(appAtomRegistry.get(planComposerDraftsAtom));
  appAtomRegistry.set(planComposerDraftsAtom, next);
  persist(next);
}

export function setPlanComposerDraftText(key: string, text: string): void {
  update((current) => setPlanComposerDraftTextState(current, key, text));
}

export function setPlanComposerDraftModelChoice(
  key: string,
  directive: PlanningModelSelection,
  atHead: string | null,
): void {
  update((current) => setPlanComposerDraftModelChoiceState(current, key, directive, atHead));
}

export function clearPlanComposerDraft(key: string): void {
  update((current) => clearPlanComposerDraftState(current, key));
}

export function usePlanComposerDraft(key: string | null): PlanComposerDraft {
  const drafts = useAtomValue(planComposerDraftsAtom);
  useEffect(() => ensureLoaded(), []);
  return key === null ? EMPTY_DRAFT : normalized(drafts[key]);
}
