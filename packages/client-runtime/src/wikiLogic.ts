import { reviewCanvasFiles, type CanvasReview } from "@mercurian/wiki/canvas";
import type {
  WikiChangeRequest,
  WikiChangeRequestDetail,
  WikiChangeRequestId,
  WikiIndexError,
  WikiIndexResult,
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

/** A document's name as a person reads it: without a `.base` or `.canvas`, which its icon shows. */
export const documentTitle = (name: string): string => name.replace(/\.(base|canvas)$/i, "");

/**
 * A canvas read in an open change request, marked with what that changes: `text` over its version
 * from before, so the board and its marks are always the same commit. Null when there's nothing
 * to mark, or its JSON doesn't read.
 */
export function changeRequestCanvasReview(
  detail: Pick<WikiChangeRequestDetail, "changeRequest" | "files"> | null,
  file: string,
  text: string | null,
): CanvasReview | null {
  if (detail?.changeRequest.status !== "open" || text === null) return null;
  const change = detail.files.find((each) => each.file === file);
  if (change === undefined) return null;
  const review = reviewCanvasFiles(change.before, text);
  return "invalid" in review ? null : review;
}

/** A board's title as the name to keep it under: flat, with nothing a file name can't hold. */
export const keepCanvasName = (title: string): string =>
  title
    .replace(/[/\\\0-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");

/** A document named by its file: a base and a canvas are, as a link to either has to be. */
export const isCanvasName = (name: string): boolean => /\.canvas$/i.test(name);

const NOT_NOTES = new Set(["readme.md", "agents.md", "claude.md"]);

/**
 * The name a wiki tab opens a repository file by: a top-level note's, or the file name of a base
 * or canvas, at any depth for a canvas. Null for any other file (one in a folder, a skill map, an
 * attachment), which opens as a file.
 */
export function wikiDocumentName(file: string): string | null {
  if (/^[^/]+\.base$/i.test(file) || isCanvasName(file)) return file;
  return /^[^/]+\.md$/i.test(file) &&
    !NOT_NOTES.has(file.toLowerCase()) &&
    !/\.skillmap\.md$/i.test(file)
    ? noteNameOfFile(file)
    : null;
}

/** Everything a wiki's links can name: its notes, and its canvases and bases by file. */
export const wikiDocumentNames = (
  index: Pick<WikiIndexResult, "notes" | "canvases" | "bases">,
): ReadonlyArray<string> => [
  ...index.notes.map((note) => note.name),
  ...index.canvases.map((canvas) => canvas.file),
  ...index.bases.map((base) => base.file),
];

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

/**
 * What to do about a conflict, from where the person is. An amendment can't write a canvas, so
 * until agents can, a canvas is settled by hand in the change request's worktree.
 */
export function mergeConflictAdvice(
  conflicts: ReadonlyArray<string>,
  from: "computer" | "phone",
): string {
  if (conflicts.length === 0)
    return "Amend this change request to settle the conflict, then merge.";
  const both = `Edited on both sides: ${conflicts.join(", ")}.`;
  if (!conflicts.some(isCanvasName)) {
    return `${both} Amend this change request to settle them, then merge.`;
  }
  return from === "phone"
    ? `${both} A canvas can't be settled from the phone. On a computer, edit it in this change request's worktree so the clashing cards agree with main, and save the edits to the change request.`
    : `${both} A canvas is settled in this change request's worktree: edit it there, in Obsidian or any editor, so the clashing cards agree with main, then use Save edits to the change request and merge.`;
}

/** A standing index error in plain words. */
export function describeIndexError(error: WikiIndexError): string {
  if (error.edge) {
    return `A map edge lost its prose link: ${error.edge.from} → ${error.edge.to} (${error.edge.type}) in ${error.file}. Link the two notes in prose, or remove the edge.`;
  }
  return `${error.file}: ${error.error}`;
}

/**
 * A wiki failure as a person reads it. The server words each one, a busy checkout included: it
 * names the folder (the wiki's, or a change request's worktree) and the files.
 */
export function describeWikiFailure(failure: unknown): string {
  if (isWikiError(failure)) return failure.message;
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
