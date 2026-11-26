import type { WikiChangeRequest, WikiIndexResult } from "@t3tools/contracts";
import type { WikiEditorAuthor, WikiEditorResolvedLink } from "@mercurian/wiki-editor/protocol";
import type { WikiPlacement } from "@mercurian/wiki/placement";
import { folderOf, type ProjectFile } from "@mercurian/wiki/resolve-link";
import {
  authorColor,
  latestAmendmentFor,
  PERSON_ACTOR,
  projectWikiLinkFile,
  resolveProjectWikiLink,
  wikiLinkOpens,
} from "@t3tools/client-runtime/wikiLogic";

/** Where the document is read from, for the header's subtitle. */
export function wikiDocumentSubtitle(input: {
  readonly wikiName: string | null;
  /** What's read: the title alone can't tell one folder's Plan from another's. */
  readonly file: string;
  /** The change request the document is read inside; null reads main. */
  readonly changeRequest: (Pick<WikiChangeRequest, "title"> & { readonly draft?: boolean }) | null;
  readonly readsChangeRequest: boolean;
  /** Read and written in the folder on disk, uncommitted edits and all. */
  readonly onDisk?: boolean;
  readonly noun: string;
  readonly agentWorking: boolean;
  /** How the edits stand, when they stand anywhere worth saying. */
  readonly saving?: string | null;
}): string {
  const scope = input.onDisk
    ? "On disk"
    : !input.readsChangeRequest
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

/** What a link in a project's document opens. */
export type ProjectLinkOpen =
  | { readonly kind: "open"; readonly root: string; readonly file: string }
  /** A bare link its own root misses and several others match: the person picks, never us. */
  | { readonly kind: "ambiguous"; readonly candidates: ReadonlyArray<ProjectFile> }
  /** A red `./` or `../` link, which makes no note. */
  | { readonly kind: "none" };

/**
 * Where a link written in `from` of root `root` goes across the project's roots: the file it lands
 * on, its own root first; a new note where the placement puts one for a red link in this root, or
 * in the root it names with `root:`. Without this root's index, it reads as this root alone.
 */
export function projectLinkOpens(input: {
  readonly roots: ReadonlyMap<string, WikiIndexResult> | null;
  readonly root: string;
  readonly target: string;
  readonly from: string | null;
  readonly placement: WikiPlacement;
}): ProjectLinkOpen {
  const own = input.roots?.get(input.root) ?? null;
  const here = (): ProjectLinkOpen => {
    const file = wikiLinkOpens(own, input.target, input.from, input.placement);
    return file === null ? { kind: "none" } : { kind: "open", root: input.root, file };
  };
  if (input.roots === null || own === null) return here();
  const linker = { root: input.root, file: input.from };
  const found = resolveProjectWikiLink(input.roots, input.target, linker);
  if (found.file !== null) return { kind: "open", ...found.file };
  if (found.ambiguous.length > 0) return { kind: "ambiguous", candidates: found.ambiguous };
  const unwritten = projectWikiLinkFile(input.roots, input.target, linker);
  return unwritten === null || unwritten.root === input.root
    ? here()
    : { kind: "open", ...unwritten };
}

/** A file as a link from `root` names it: bare in its own root, `key:path` in another. */
export const projectFileLabel = (file: ProjectFile, root: string): string =>
  file.root === root ? file.file : `${file.root}:${file.file}`;

/** What a link preview says it landed on, files in other roots named with their root. */
export function projectResolvedLink(
  roots: ReadonlyMap<string, WikiIndexResult> | null,
  root: string,
  target: string,
  from: string | null,
): WikiEditorResolvedLink | null {
  if (roots === null || !roots.has(root)) return null;
  const found = resolveProjectWikiLink(roots, target, { root, file: from });
  return {
    file: found.file === null ? null : projectFileLabel(found.file, root),
    others: (found.file === null ? found.ambiguous : found.others).map((file) =>
      projectFileLabel(file, root),
    ),
  };
}
