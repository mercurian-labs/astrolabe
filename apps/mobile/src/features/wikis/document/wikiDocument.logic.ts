import type { WikiChangeRequest } from "@t3tools/contracts";
import type { WikiEditorAuthor } from "@mercurian/wiki-editor/protocol";
import { folderOf } from "@mercurian/wiki/resolve-link";
import { authorColor, latestAmendmentFor, PERSON_ACTOR } from "@t3tools/client-runtime/wikiLogic";

/** Where the document is read from, for the header's subtitle. */
export function wikiDocumentSubtitle(input: {
  readonly wikiName: string | null;
  /** What's read: the title alone can't tell one folder's Plan from another's. */
  readonly file: string;
  /** The change request the document is read inside; null reads main. */
  readonly changeRequest: (Pick<WikiChangeRequest, "title"> & { readonly draft?: boolean }) | null;
  readonly readsChangeRequest: boolean;
  readonly noun: string;
  readonly agentWorking: boolean;
  /** How the edits stand, when they stand anywhere worth saying. */
  readonly saving?: string | null;
}): string {
  const scope = !input.readsChangeRequest
    ? "Main"
    : input.changeRequest?.draft
      ? "In your draft"
      : input.changeRequest
        ? `In “${input.changeRequest.title}”`
        : `In a ${input.noun}`;
  return [
    input.wikiName,
    folderOf(input.file),
    scope,
    input.agentWorking ? "agent working" : null,
    input.saving ?? null,
  ]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");
}

/**
 * Who wrote the version of `file` the change request now holds, as the editor marks it: the
 * newest amendment's actor (an edit saved elsewhere reads as "You, elsewhere"), in the running
 * turn when the change request's thread is mid-turn, else in that amendment.
 */
export function wikiDocumentAuthor(input: {
  readonly changeRequest: Pick<WikiChangeRequest, "amendments"> | undefined;
  readonly file: string;
  readonly runId: string | null;
}): WikiEditorAuthor {
  const latest = latestAmendmentFor(input.changeRequest, input.file);
  const name =
    latest === null ? "Agent" : latest.actor === PERSON_ACTOR ? "You, elsewhere" : latest.actor;
  return {
    name,
    color: authorColor(name),
    turnId: input.runId !== null ? `run:${input.runId}` : `amendment:${latest?.commit ?? ""}`,
  };
}

/** A skill map arranges notes; it is read, never typed into. */
export const isSkillMapFile = (file: string) => file.endsWith(".skillmap.md");

/** A `.base` file, named by its file name: it opens as its view, read only, never as a note. */
export const isWikiBaseFile = (name: string) => name.endsWith(".base");
