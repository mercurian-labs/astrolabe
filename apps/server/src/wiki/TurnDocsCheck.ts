/**
 * At a turn's end, the documents it changed in the thread's project folders: a base that doesn't
 * work as written, and a bare link that several folders answer, which opens none of them.
 * @module TurnDocsCheck
 */
import {
  BASE_SYNTAX_REMINDER,
  documentBaseCheck,
  isBaseFile,
  isWikiDocument,
  key,
  projectLinkDestination,
} from "@mercurian/wiki";
import { type ProjectId, projectRootId, WikiId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { isWithinRoot } from "../workspace/KnownWorkspaces.ts";
import * as ProjectRoots from "../workspace/ProjectRoots.ts";
import * as WikiService from "./WikiService.ts";

/** A document the turn changed, where it is: its folder's key, its path there, and on disk. */
interface ChangedDocument {
  readonly root: string;
  readonly file: string;
  readonly path: string;
}

/** A base a turn saved that doesn't work as written. */
export interface BrokenBase extends ChangedDocument {
  readonly problems: ReadonlyArray<string>;
}

/** A bare link in a document the turn saved that several of the project's folders answer. */
export interface AmbiguousLink extends ChangedDocument {
  readonly target: string;
  /** Each match as `folder:path`. */
  readonly matches: ReadonlyArray<string>;
}

export interface TurnDocsProblems {
  readonly bases: ReadonlyArray<BrokenBase>;
  readonly links: ReadonlyArray<AmbiguousLink>;
}

const NO_PROBLEMS: TurnDocsProblems = { bases: [], links: [] };

const located = ({ root, file, path }: ChangedDocument) => `${file} in ${root} (${path}):`;

/** What the app tells the agent whose turn left documents broken. */
export function turnDocsMessage({ bases, links }: TurnDocsProblems): string {
  const found = [
    ...(bases.length === 0
      ? []
      : [
          bases.length === 1
            ? "one base doesn't work as written"
            : `${bases.length} bases don't work as written`,
        ]),
    ...(links.length === 0
      ? []
      : [links.length === 1 ? "one link is ambiguous" : `${links.length} links are ambiguous`]),
  ];
  const oneBase = bases.length === 1;
  return [
    `Astrolabe checked the documents your last turn changed, and ${found.join(" and ")}.`,
    ...bases.map((base) =>
      [located(base), ...base.problems.map((problem) => `- ${problem}`)].join("\n"),
    ),
    ...(bases.length === 0 ? [] : [`How a base is written:\n${BASE_SYNTAX_REMINDER}`]),
    ...links.map((link) =>
      [
        located(link),
        `- [[${link.target}]] could open ${link.matches.join(" or ")}, so it opens none of them.`,
      ].join("\n"),
    ),
    [
      ...(bases.length === 0
        ? []
        : [
            `Fix ${oneBase ? "the base" : "the bases"}, then run ${oneBase ? "it" : "each"} with astrolabe_project_query to check what it lists.`,
          ]),
      ...(links.length === 0
        ? []
        : [
            `Write ${links.length === 1 ? "the link" : "each link"} with the folder it means, as [[folder:Path]].`,
          ]),
    ].join(" "),
  ].join("\n\n");
}

/** The follow-up's notification line. */
export function turnDocsSummary({ bases, links }: TurnDocsProblems): string {
  if (links.length === 0) {
    return bases.length === 1 ? "A base needs fixing" : `${bases.length} bases need fixing`;
  }
  if (bases.length === 0) {
    return links.length === 1 ? "A link needs fixing" : `${links.length} links need fixing`;
  }
  return `${bases.length + links.length} documents need fixing`;
}

export class TurnDocsCheck extends Context.Service<
  TurnDocsCheck,
  {
    /**
     * Checks the documents among the files the turn changed, each a path from the checkout it
     * changed in. Failures are logged, never raised.
     */
    readonly check: (input: {
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
      readonly changed: ReadonlyArray<{ readonly cwd: string; readonly file: string }>;
    }) => Effect.Effect<TurnDocsProblems>;
  }
>()("t3/wiki/TurnDocsCheck") {}

const make = Effect.gen(function* () {
  const wikis = yield* WikiService.WikiService;
  const projectRoots = yield* ProjectRoots.ProjectRoots;
  const path = yield* Path.Path;

  const check: TurnDocsCheck["Service"]["check"] = Effect.fn("TurnDocsCheck.check")(
    function* (input) {
      const candidates = input.changed.flatMap(({ cwd, file }) =>
        isWikiDocument(path.basename(file)) ? [path.join(cwd, file)] : [],
      );
      if (candidates.length === 0) return NO_PROBLEMS;
      const roots = (yield* projectRoots.forThread(input)).filter(
        (root) => root.state !== "missing",
      );
      const folderOf = (root: (typeof roots)[number]) => root.checkout ?? root.path;
      // A nested folder is its own root, so the deepest one holding a file has it.
      const documents = new Map<string, ChangedDocument>();
      for (const changed of candidates) {
        let best: ChangedDocument | null = null;
        for (const root of roots) {
          const folder = folderOf(root);
          if (!isWithinRoot(path, changed, folder)) continue;
          const file = path.relative(folder, changed).split(path.sep).join("/");
          if (best === null || file.length < best.file.length) {
            best = { root: root.key, file, path: changed };
          }
        }
        if (best !== null) documents.set(`${best.root}\0${best.file}`, best);
      }
      if (documents.size === 0) return NO_PROBLEMS;
      const index = yield* wikis.projectIndex(
        roots.map((root) => ({
          key: root.key,
          wikiId: WikiId.make(projectRootId(input.projectId, root.key)),
          checkout: folderOf(root),
          writable: root.writable,
        })),
      );
      const bases: BrokenBase[] = [];
      const links: AmbiguousLink[] = [];
      for (const document of documents.values()) {
        const rootIndex = index.roots.get(document.root);
        if (rootIndex === undefined) continue;
        const note = rootIndex.notes.get(document.file);
        // A file the turn deleted is in no index, and holds nothing to check.
        const source = isBaseFile(document.file)
          ? rootIndex.bases.get(document.file)
          : note?.source;
        if (source !== undefined) {
          const { errors, warnings } = documentBaseCheck(document.file, source);
          const problems = [...errors, ...warnings];
          if (problems.length > 0) bases.push({ ...document, problems });
        }
        const outgoing = note?.links ?? rootIndex.canvases.get(document.file)?.links ?? [];
        const seen = new Set<string>();
        for (const link of outgoing) {
          const { ambiguous } = projectLinkDestination(index, link, document);
          if (ambiguous.length === 0 || seen.has(key(link.target))) continue;
          seen.add(key(link.target));
          links.push({
            ...document,
            target: link.target,
            matches: ambiguous.map((match) => `${match.root}:${match.file}`),
          });
        }
      }
      return { bases, links };
    },
    (effect, input) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not check the documents a turn changed.", {
            projectId: input.projectId,
            cause,
          }).pipe(Effect.as(NO_PROBLEMS)),
        ),
      ),
  );

  return TurnDocsCheck.of({ check });
});

export const layer = Layer.effect(TurnDocsCheck, make);
