import type {
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiIndexError,
  WikiMergePreview,
  WikiMirrorStatus,
} from "@t3tools/contracts";

/**
 * Astrolabe: how wiki state reads to a person, shared by the web and mobile clients: note
 * names, save targets, merge readiness, failures, the mirror, and live agent turns.
 */

/** The comparison key the wiki uses for note names. */
export const noteKey = (name: string): string => name.normalize("NFC").toLowerCase();

export const noteNameOfFile = (file: string): string => file.replace(/\.md$/i, "");

/**
 * Where an edit is saved by default: the change request the page reads from when it is open,
 * else a new one.
 */
export function defaultSaveTarget(
  openChangeRequests: ReadonlyArray<Pick<WikiChangeRequest, "changeRequestId">>,
  viewing: WikiChangeRequestId | undefined,
): WikiChangeRequestId | null {
  if (viewing === undefined) return null;
  return openChangeRequests.some((changeRequest) => changeRequest.changeRequestId === viewing)
    ? viewing
    : null;
}

/** Why Merge cannot run, or null when it can. */
export function mergeBlockedReason(input: {
  readonly canWrite: boolean;
  readonly preview: WikiMergePreview;
}): string | null {
  if (!input.canWrite) return "You don't have permission to change this wiki.";
  switch (input.preview.status) {
    case "conflict":
      return input.preview.conflicts.length > 0
        ? `Conflicts with main in ${input.preview.conflicts.join(", ")}.`
        : "Conflicts with main.";
    case "up-to-date":
      return "Nothing to merge: main already has these changes.";
    case "clean":
      return null;
  }
}

/** A standing index error in plain words. */
export function describeIndexError(error: WikiIndexError): string {
  if (error.edge) {
    return `A map edge lost its prose link: ${error.edge.from} → ${error.edge.to} (${error.edge.type}) in ${error.file}. Link the two notes in prose, or remove the edge.`;
  }
  return `${error.file}: ${error.error}`;
}

/** A wiki failure as a person reads it. */
export function describeWikiFailure(failure: unknown): string {
  if (isWikiError(failure)) {
    if (failure.reason === "checkout-busy") {
      return `The wiki folder has local edits that overlap this change. Commit or discard them in the folder, then try again. (${failure.message})`;
    }
    return failure.message;
  }
  if (failure instanceof Error && failure.message.trim()) return failure.message;
  return "The wiki request failed.";
}

function isWikiError(
  value: unknown,
): value is { readonly _tag: "WikiError"; readonly reason: string; readonly message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { _tag?: unknown })._tag === "WikiError" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

export type MirrorTone = "none" | "ok" | "pending" | "error" | "warning";

/** The mirror's state in one short phrase and tone, for rows and headers. */
export function summarizeMirror(
  mirror: WikiMirrorStatus | null,
  formatAgo: (iso: string) => string,
): { readonly tone: MirrorTone; readonly label: string } {
  if (mirror === null) return { tone: "none", label: "No mirror" };
  if (mirror.lastError) return { tone: "error", label: "Mirror push failed" };
  if (
    mirror.overwroteRemoteAt &&
    (mirror.lastPushedAt === null || mirror.overwroteRemoteAt >= mirror.lastPushedAt)
  ) {
    return { tone: "warning", label: "Mirror overwritten" };
  }
  if (mirror.lastPushedAt) {
    return { tone: "ok", label: `Mirrored ${formatAgo(mirror.lastPushedAt)}` };
  }
  return { tone: "pending", label: "Mirror not pushed yet" };
}

/** The actor the server records for edits made from the app, as opposed to an agent's model. */
export const PERSON_ACTOR = "You";

const ACTIVE_TURN = new Set(["preparing", "queued", "starting", "running", "waiting"]);

/** A thread whose shell reports this status has a turn in flight. */
export const isTurnRunning = (status: string | null | undefined): boolean =>
  status !== null && status !== undefined && ACTIVE_TURN.has(status);

/** The change request's newest amendment that changed `file`. */
export function latestAmendmentFor(
  changeRequest: Pick<WikiChangeRequest, "amendments"> | undefined,
  file: string,
): WikiChangeRequest["amendments"][number] | null {
  let latest: WikiChangeRequest["amendments"][number] | null = null;
  for (const amendment of changeRequest?.amendments ?? []) {
    if (!amendment.files.includes(file)) continue;
    if (latest === null || amendment.at >= latest.at) latest = amendment;
  }
  return latest;
}

// Six-digit hex only: the editor's collaboration layer tints with `${color}33`.
const AUTHOR_COLORS = ["#d946ef", "#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6", "#f43f5e"];

/** One colour per author name, the same on every load. */
export function authorColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return AUTHOR_COLORS[hash % AUTHOR_COLORS.length]!;
}

/** A save waiting for the turn of the change request's thread to end. */
export interface QueuedWikiSave {
  readonly changeRequestId: WikiChangeRequestId;
  readonly message: string;
}

/**
 * What a queued save does now: wait while the turn runs, commit once it ended, nothing when no
 * save is queued or one is already being committed.
 */
export function queuedSaveStep(input: {
  readonly queued: QueuedWikiSave | null;
  readonly turnRunning: boolean;
  readonly committing: boolean;
}): "idle" | "wait" | "commit" {
  if (input.queued === null || input.committing) return "idle";
  return input.turnRunning ? "wait" : "commit";
}
