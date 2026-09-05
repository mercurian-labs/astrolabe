import type {
  MemoryAmendmentSummary,
  MemoryCatalog,
  MemoryChangedDocument,
  MemoryDashboard,
  MemoryDocumentTarget,
  MemoryLocalGraph,
  MemoryMergeReview,
  MemoryPosition,
  MemoryReadingPosition,
  MemoryUnavailable,
  MercurianCommitId,
  MercurianMergeMemoryHomeResult,
} from "@t3tools/contracts";

import { memoryReadingKey } from "../../memoryIdentity";
import type { MemorySelection } from "../../memoryPanelStore";

export type MemoryAvailableDashboard = Extract<MemoryDashboard, { readonly kind: "available" }>;

/** What the tab knows about the line's memory at the selected position. */
export type MemoryDashboardState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly dashboard: MemoryDashboard };

/** The route decides the position; Memory never grows a second history picker. */
export function memoryReadingPositionFor(input: {
  readonly viewingPast: boolean;
  readonly head: MercurianCommitId | null;
}): MemoryReadingPosition {
  return input.viewingPast && input.head !== null
    ? { kind: "checkpoint", commitId: input.head }
    : { kind: "latest" };
}

export const isHistoricalMemoryPosition = (position: MemoryReadingPosition) =>
  position.kind !== "latest";

export function memoryPositionNotice(input: {
  readonly reading: MemoryReadingPosition;
  readonly position: MemoryPosition | null;
  readonly activeTurn: boolean;
}): string {
  if (input.reading.kind === "checkpoint") {
    return `Reading memory as captured at checkpoint ${input.reading.commitId.slice(0, 8)}. Review and revert wait until you return to the latest position.`;
  }
  if (input.reading.kind === "turn") {
    return `Reading memory as captured after turn ${input.reading.turnCount}. Review and revert wait until you return to the latest position.`;
  }
  const captureKind = input.position?.captureKind ?? null;
  const captured =
    captureKind === null
      ? "the line's latest captured work"
      : `the line's latest ${captureKind} capture`;
  return input.activeTurn
    ? `A turn is running. This shows ${captured}; edits the turn has not captured yet are not here.`
    : `Showing ${captured} and its committed amendments.`;
}

export function memoryUnavailableCopy(reason: MemoryUnavailable["reason"]): string {
  switch (reason) {
    case "not-designated":
      return "This project has no designated memory.";
    case "line-missing":
      return "This line has no memory branch yet. Memory appears after its first captured turn.";
    case "checkpoint-missing":
      return "This checkpoint recorded no memory capture. Choose a later checkpoint or return to the latest position.";
    case "baseline-missing":
      return "The line's memory baseline is missing, so changes cannot be computed here.";
    case "object-missing":
      return "A captured memory object is missing from the repository. This position cannot be read.";
    case "effective-tree-conflict":
      return "The captured memory delta no longer composes onto the line's current head.";
    case "git-too-old":
      return "Reading captured memory requires Git 2.38 or newer on this environment.";
  }
}

export function memoryDocumentStatusLabel(document: MemoryChangedDocument): string {
  switch (document.status) {
    case "added":
      return "Added";
    case "modified":
      return "Modified";
    case "deleted":
      return "Deleted";
    case "restored":
      return "Restored";
    case "renamed": {
      const former = document.previousPaths.at(-1);
      return former === undefined ? "Renamed" : `Renamed from ${former}`;
    }
  }
}

export function memoryDocumentKindLabel(kind: MemoryChangedDocument["kind"]): string {
  switch (kind) {
    case "note":
      return "Note";
    case "skill-map":
      return "Skill map";
    case "document":
      return "Document";
  }
}

export function memoryAmendmentAttribution(kind: MemoryAmendmentSummary["kind"]): string {
  switch (kind) {
    case "marked":
      return "Landed by the assistant";
    case "hand":
      return "Committed by hand";
    case "unmarked":
      return "Captured, not yet committed";
  }
}

/** Server order is authoritative for commits; the captured unmarked tail always reads last. */
export function memoryNeedsReview(
  amendments: ReadonlyArray<MemoryAmendmentSummary>,
): ReadonlyArray<MemoryAmendmentSummary> {
  const unreviewed = amendments.filter((amendment) => !amendment.reviewed);
  return [
    ...unreviewed.filter((amendment) => amendment.kind !== "unmarked"),
    ...unreviewed.filter((amendment) => amendment.kind === "unmarked"),
  ];
}

export const memoryDocumentName = (path: string) =>
  path
    .slice(path.lastIndexOf("/") + 1)
    .replace(/\.skillmap\.md$/u, "")
    .replace(/\.(?:md|yaml)$/u, "");

/** Turn a name-addressed selection into the changed document it names, when the line changed it. */
export function resolveMemoryNoteSelection(
  dashboard: MemoryAvailableDashboard,
  name: string,
): MemoryChangedDocument | null {
  const wanted = name.trim().toLocaleLowerCase();
  if (wanted.length === 0) return null;
  const node = dashboard.graph.nodes.find(
    (candidate) => candidate.name.toLocaleLowerCase() === wanted,
  );
  if (node !== undefined) {
    const document = dashboard.documents.find((candidate) => candidate.id === node.id);
    if (document !== undefined) return document;
  }
  return (
    dashboard.documents.find(
      (document) => memoryDocumentName(document.path).toLocaleLowerCase() === wanted,
    ) ?? null
  );
}

export interface MemorySelectionHighlight {
  readonly documentIds: ReadonlySet<string>;
  readonly amendmentIds: ReadonlySet<string>;
}

/** One selection lights up its counterparts: a document's amendments, an amendment's documents. */
export function memorySelectionHighlight(
  dashboard: MemoryAvailableDashboard,
  selection: MemorySelection | null,
): MemorySelectionHighlight {
  const empty = { documentIds: new Set<string>(), amendmentIds: new Set<string>() };
  if (selection === null) return empty;
  if (selection.kind === "note") {
    const document = resolveMemoryNoteSelection(dashboard, selection.name);
    return document === null
      ? empty
      : memorySelectionHighlight(dashboard, { kind: "document", id: document.id });
  }
  if (selection.kind === "document") {
    const document = dashboard.documents.find((candidate) => candidate.id === selection.id);
    return document === undefined
      ? empty
      : { documentIds: new Set([document.id]), amendmentIds: new Set(document.amendmentIds) };
  }
  const amendment = dashboard.amendments.find((candidate) => candidate.id === selection.id);
  return amendment === undefined
    ? empty
    : { documentIds: new Set(amendment.documentIds), amendmentIds: new Set([amendment.id]) };
}

/** Maps are reviewed as documents; a graph with no note nodes and only maps is the map-only state. */
export const memoryGraphIsMapOnly = (dashboard: MemoryAvailableDashboard) =>
  dashboard.graph.nodes.length === 0 &&
  dashboard.documents.length > 0 &&
  dashboard.documents.every((document) => document.kind === "skill-map");

/** Why there is nothing to draw, said truthfully; null when the graph has nodes. */
export function memoryGraphEmptyCopy(dashboard: MemoryAvailableDashboard): string | null {
  if (dashboard.graph.nodes.length > 0) return null;
  if (dashboard.documents.length === 0) {
    return dashboard.amendments.length === 0
      ? "No memory notes changed on this line."
      : `${dashboard.amendments.length === 1 ? "This amendment" : "These amendments"} changed no memory documents, so there are no notes to draw. Open the changes for the raw comparison.`;
  }
  if (memoryGraphIsMapOnly(dashboard)) {
    return "Only skill maps changed here. Maps are reviewed as documents under Changes and are never drawn as graph nodes.";
  }
  return "The changed documents are not notes, so there is nothing to draw. They are listed under Changes.";
}

/** The Changes heading's second line when documents and amendments disagree in count. */
export function memoryChangesSummary(dashboard: MemoryAvailableDashboard): string | null {
  if (dashboard.documents.length > 0 || dashboard.amendments.length === 0) return null;
  const count = dashboard.amendments.length;
  return `No memory documents changed. ${count} ${count === 1 ? "amendment" : "amendments"} changed other files in the memory repository; open its changes for the raw comparison.`;
}

/**
 * The server names missing pieces by ticket for maintainers; people reviewing memory get
 * the capability gap in plain words. Unknown strings keep their words minus ticket ids.
 */
export function memoryLimitationCopy(limitation: string): string {
  if (/Plan\/Spec document locations/iu.test(limitation)) {
    return "Plan and spec documents inside memory are classified by the memory designation for now, not by a configured location.";
  }
  if (/stamps and structured rationales/iu.test(limitation)) {
    return "Change stamps and structured rationales are not recorded yet; a map's authored fields stay visible in the raw comparison.";
  }
  return limitation
    .replace(/\s*\((?:M-\d+(?:\/M-\d+)*)\)/gu, "")
    .replace(/\bM-\d+(?:\/M-\d+)*\s*/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

/** Structure only: statuses and review state may change without moving a node. */
export function memoryGraphStructureKey(graph: MemoryLocalGraph): string {
  return [
    graph.nodes.map((node) => node.id).join(""),
    graph.edges.map((edge) => `${edge.from}>${edge.to}`).join(""),
  ].join("");
}

export function memoryDocumentTargetForCatalogEntry(
  position: MemoryPosition,
  entry: Extract<MemoryCatalog, { readonly kind: "available" }>["entries"][number],
): MemoryDocumentTarget {
  return {
    position,
    path: entry.path,
    blobOid: entry.blobOid,
    treeOid: position.treeOid,
    deleted: false,
  };
}

export const memoryBrowseEntries = (
  catalog: Extract<MemoryCatalog, { readonly kind: "available" }>,
) => catalog.entries.toSorted((left, right) => left.path.localeCompare(right.path));

export const memoryComparisonLabel = (
  unit:
    | { readonly kind: "document"; readonly document: MemoryChangedDocument }
    | MemoryAmendmentSummary,
): string =>
  "document" in unit ? memoryDocumentName(unit.document.path) : unit.title || unit.id.slice(0, 8);

/**
 * Merge home walks in explicit human steps. Preparing never promotes; a fresh
 * review-required always replaces what was prepared before, and nothing here
 * retries a confirmation on its own.
 *
 * A deferred approval is a promise about the memory it was confirmed against.
 * It is bound to the dashboard's curation version at confirmation, which the
 * approval itself leaves unchanged, and reads stale once that version moves:
 * a revert, a new capture, or an outside change all retire the approval.
 */
export type MemoryMergeState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy"; readonly step: "prepare" | "confirm" }
  | { readonly kind: "review"; readonly review: MemoryMergeReview; readonly stale: boolean }
  | { readonly kind: "merged"; readonly commitOid: string }
  | { readonly kind: "deferred-to-push"; readonly version: string | null; readonly stale: boolean }
  | { readonly kind: "conflict"; readonly paths: ReadonlyArray<string> }
  | { readonly kind: "error"; readonly message: string };

export type MemoryMergeEvent =
  | { readonly kind: "start"; readonly step: "prepare" | "confirm" }
  | {
      readonly kind: "result";
      readonly result: MercurianMergeMemoryHomeResult;
      /** The curation version of the dashboard the person confirmed against. */
      readonly version: string | null;
    }
  | { readonly kind: "failure"; readonly message: string }
  | { readonly kind: "invalidated" }
  | { readonly kind: "dashboard"; readonly version: string }
  | { readonly kind: "dismiss" };

function memoryMergeResultState(
  result: MercurianMergeMemoryHomeResult,
  version: string | null,
): MemoryMergeState {
  switch (result.kind) {
    case "review-required":
      return { kind: "review", review: result.review, stale: false };
    case "merged":
      return { kind: "merged", commitOid: result.commitOid };
    case "deferred-to-push":
      return { kind: "deferred-to-push", version, stale: false };
    case "conflict":
      return { kind: "conflict", paths: result.conflicts.map(({ path }) => path) };
  }
}

export function memoryMergeTransition(
  state: MemoryMergeState,
  event: MemoryMergeEvent,
): MemoryMergeState {
  switch (event.kind) {
    case "start":
      return { kind: "busy", step: event.step };
    case "result":
      return memoryMergeResultState(event.result, event.version);
    case "failure":
      return { kind: "error", message: event.message };
    case "invalidated":
      return state.kind === "review" ? { ...state, stale: true } : state;
    case "dashboard":
      if (state.kind !== "deferred-to-push") return state;
      if (state.version === null) return { ...state, version: event.version };
      return state.version === event.version || state.stale ? state : { ...state, stale: true };
    case "dismiss":
      return { kind: "idle" };
  }
}

/** Confirmation binds to what the human reviewed, including an absent unmarked tail. */
export function memoryMergeConfirmInput(review: MemoryMergeReview): {
  readonly expectedVersion: string;
  readonly reviewedUnmarkedId: string | null;
} {
  return { expectedVersion: review.version, reviewedUnmarkedId: review.unmarkedId };
}

export const memoryMergeReviewIsConfirmable = (state: MemoryMergeState) =>
  state.kind === "review" && !state.stale && state.review.unreviewedIds.length === 0;

/** What a settled outcome says, null before one lands; a retired approval never reads as approved. */
export function memoryMergeStateCopy(state: MemoryMergeState): string | null {
  switch (state.kind) {
    case "merged":
      return memoryMergeHomeOutcomeCopy({ kind: "merged", commitOid: state.commitOid });
    case "deferred-to-push":
      return state.stale
        ? "Memory changed since it was approved for this repository's next push, so that approval no longer applies. Prepare again to review and approve the current memory."
        : memoryMergeHomeOutcomeCopy({ kind: "deferred-to-push" });
    case "conflict":
      return memoryMergeHomeOutcomeCopy({
        kind: "conflict",
        conflicts: state.paths.map((path) => ({ path })),
      });
    case "idle":
    case "busy":
    case "review":
    case "error":
      return null;
  }
}

export function memoryMergeHomeOutcomeCopy(result: MercurianMergeMemoryHomeResult): string {
  switch (result.kind) {
    case "review-required":
      return result.review.unreviewedIds.length === 0
        ? "Every change is reviewed. Confirm to merge home."
        : `${result.review.unreviewedIds.length} ${result.review.unreviewedIds.length === 1 ? "change still needs" : "changes still need"} review before memory can merge home.`;
    case "merged":
      return `Memory merged home at ${result.commitOid.slice(0, 8)}.`;
    case "deferred-to-push":
      return "Memory review approved for this repository's next push or pull request. It is not merged home until that ships, and pushes carry commits only, so commit any pending memory work first.";
    case "conflict":
      return `Memory conflicts with main in ${result.conflicts.map(({ path }) => path).join(", ")}.`;
  }
}

export interface MemoryCurationRefusal {
  readonly message: string;
  /** The typed reason when the server gave one; lets the caller refresh on a stale version. */
  readonly reason?: string;
  readonly paths?: ReadonlyArray<string>;
  readonly reconciliationSeed?: string;
}

const isTagged = (cause: unknown): cause is { readonly _tag: string; readonly reason?: unknown } =>
  typeof cause === "object" && cause !== null && "_tag" in cause;

/** Every typed refusal keeps the person's edits and says what to do next. */
export function memoryCurationRefusal(
  cause: unknown,
  act: "review" | "revert" | "merge",
): MemoryCurationRefusal {
  const verb =
    act === "merge" ? "merging memory home" : act === "revert" ? "reverting" : "reviewing";
  if (isTagged(cause) && cause._tag === "MemoryReviewBlockedError") {
    const paths =
      "paths" in cause && Array.isArray(cause.paths)
        ? cause.paths.filter((path): path is string => typeof path === "string")
        : undefined;
    const seed =
      "reconciliationSeed" in cause && typeof cause.reconciliationSeed === "string"
        ? cause.reconciliationSeed
        : undefined;
    const withDetails = (message: string): MemoryCurationRefusal => ({
      message,
      ...(typeof cause.reason === "string" ? { reason: cause.reason } : {}),
      ...(paths === undefined ? {} : { paths }),
      ...(seed === undefined ? {} : { reconciliationSeed: seed }),
    });
    switch (cause.reason) {
      case "turn-active":
        return withDetails(`Wait for the active turn to finish before ${verb}.`);
      case "slot-busy":
        return withDetails(
          "The line's working slot is leased by a terminal, a preview, or another project. Release it and try again.",
        );
      case "slot-dirty":
        return withDetails(
          `The slot has uncaptured edits${paths && paths.length > 0 ? ` in ${paths.join(", ")}` : ""}. Nothing was changed; capture or reconcile them first.`,
        );
      case "historical-position":
        return withDetails("Return to the latest position before curating memory.");
      case "stale-review":
        return withDetails(
          act === "merge"
            ? "Memory changed since this was prepared. Prepare again to continue."
            : "Memory changed since this dashboard was read. It has been refreshed; check the change and try again.",
        );
      case "conflict":
        return withDetails(
          `The inverse overlaps later changes${paths && paths.length > 0 ? ` in ${paths.join(", ")}` : ""}. Nothing was changed.`,
        );
      case "not-on-line":
        return withDetails("That change is no longer part of this line's visible memory changes.");
    }
  }
  if (isTagged(cause) && cause._tag === "MergeMemoryHomeBlockedError") {
    switch (cause.reason) {
      case "git-too-old":
        return { message: "Update to Git 2.38 or newer to merge this standalone memory home." };
      case "checkout-dirty":
        return {
          message: "Commit or stash the memory checkout's changes before merging home.",
        };
      case "main-missing":
        return { message: "Create the local memory home branch before merging home." };
    }
  }
  return {
    message:
      cause instanceof Error
        ? cause.message
        : act === "merge"
          ? "Could not merge memory home."
          : "Could not update this memory change.",
  };
}

export const memoryMergeHomeRefusalCopy = (cause: unknown) =>
  memoryCurationRefusal(cause, "merge").message;

export const memoryMergeHomeReconciliationMessage = (paths: ReadonlyArray<string>) =>
  `Reconcile the memory changes on ${paths.join(", ")} against current main and land the reconciliation as an amendment`;

export const memoryRevertInvestigationMessage = (amendment: MemoryAmendmentSummary) =>
  `Investigate the memory amendment "${amendment.title || amendment.id.slice(0, 8)}": its revert overlaps later changes. Propose how to reconcile them as a new amendment`;

/** Composer text grows by a blank line; it is never sent from here. */
export function appendToDraftPrompt(prompt: string, addition: string): string {
  const trimmedAddition = addition.trim();
  if (trimmedAddition.length === 0) return prompt;
  return prompt.trim().length === 0 ? trimmedAddition : `${prompt.trimEnd()}\n\n${trimmedAddition}`;
}

/** What a catalog or note request was for: the environment, line, and reading it was issued at. */
export function memoryRequestScope(input: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly reading: MemoryReadingPosition;
}): string {
  return `${input.environmentId}\0${input.threadId}\0${memoryReadingKey(input.reading)}`;
}

/** A note lookup is also bound to the selection that asked for it. */
export function memoryNoteRequestScope(
  scope: string,
  selection: MemorySelection | null,
): string | null {
  return selection?.kind === "note" ? `${scope}\0note\0${selection.name}` : null;
}

export interface MemoryRequestToken {
  readonly scope: string;
  readonly sequence: number;
}

/**
 * Latest-wins by scope. A response settles only when it is the newest request
 * this gate issued and the scope it was issued for is still the live one, so a
 * late answer for an earlier position, line, or selection changes nothing.
 */
export function createMemoryRequestGate() {
  let latest = 0;
  return {
    begin(scope: string): MemoryRequestToken {
      latest += 1;
      return { scope, sequence: latest };
    },
    settles(token: MemoryRequestToken, liveScope: string | null): boolean {
      return token.sequence === latest && token.scope === liveScope;
    },
  };
}

export const memoryTabRevertTarget = (
  amendment: MemoryAmendmentSummary,
): { readonly kind: "commit"; readonly commitOid: string } | { readonly kind: "unmarked" } =>
  amendment.kind === "unmarked"
    ? { kind: "unmarked" }
    : { kind: "commit", commitOid: amendment.id };
