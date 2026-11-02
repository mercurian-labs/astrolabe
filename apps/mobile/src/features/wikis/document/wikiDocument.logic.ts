import type { WikiChangeRequest } from "@t3tools/contracts";
import type { WikiEditorAuthor } from "@mercurian/wiki-editor/protocol";
import { authorColor, latestAmendmentFor, PERSON_ACTOR } from "@t3tools/client-runtime/wikiLogic";

/** Where the document is read from, for the header's subtitle. */
export function wikiDocumentSubtitle(input: {
  readonly wikiName: string | null;
  /** The change request the document is read inside; null reads main. */
  readonly changeRequest: Pick<WikiChangeRequest, "title"> | null;
  readonly readsChangeRequest: boolean;
  readonly agentWorking: boolean;
}): string {
  const scope = !input.readsChangeRequest
    ? "Main"
    : input.changeRequest
      ? `In “${input.changeRequest.title}”`
      : "In a change request";
  return [input.wikiName, scope, input.agentWorking ? "agent working" : null]
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

/** A base's title, its file name without `.base`, as web's tab reads. */
export const wikiBaseTitle = (file: string) => file.replace(/\.base$/, "");
