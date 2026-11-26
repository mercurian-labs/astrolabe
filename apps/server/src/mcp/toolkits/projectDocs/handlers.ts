import { BASE_SYNTAX_REMINDER, BaseError, findMap, type ProjectIndex } from "@mercurian/wiki";
import {
  OrchestratorMcpFailure,
  parseRootAddress,
  type ProjectRootCheckout,
  projectRootId,
  type WikiAgentTransform,
  WikiError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import * as WikiService from "../../../wiki/WikiService.ts";
import {
  lookupProjectDocument,
  projectAddress,
  projectLinksResult,
} from "../../../wiki/wikiViews.ts";
import { isWithinRoot } from "../../../workspace/KnownWorkspaces.ts";
import * as ProjectRoots from "../../../workspace/ProjectRoots.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { ProjectDocsToolkit } from "./tools.ts";

// Wiki errors carry fixed or validation messages written for the author, so they pass through.
const wikiFailure = (error: WikiError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "git-failed" || error.reason === "git-unavailable"
        ? "orchestration_error"
        : "invalid_request",
    message: error.message,
  });

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/** A folder of the calling thread's project, with where the thread reads it. */
interface Root extends ProjectRootCheckout {
  readonly read: WikiService.ProjectRootRead;
}

interface Access {
  readonly roots: ReadonlyArray<Root>;
  readonly wikis: WikiService.WikiService["Service"];
  readonly path: Path.Path;
  readonly author: WikiService.WikiAuthor;
}

const keys = (roots: ReadonlyArray<Root>) => roots.map((root) => root.key).join(", ");

/**
 * The calling thread's project folders, each read in the thread's checkout of it, or in its own
 * folder when the thread has none; a folder that is gone is left out.
 */
const access = Effect.fn("ProjectDocsToolkit.access")(function* () {
  const { scope, caller } = yield* readCaller();
  if (caller === undefined) {
    return yield* invalid("These tools read a thread's project: call them from a thread.");
  }
  const checkouts = yield* (yield* ProjectRoots.ProjectRoots)
    .forThread({ projectId: caller.projectId, worktreePath: caller.worktreePath })
    .pipe(Effect.mapError((error) => invalid(error.message)));
  const roots = checkouts.flatMap((root): ReadonlyArray<Root> =>
    root.state === "missing"
      ? []
      : [
          {
            ...root,
            read: {
              key: root.key,
              wikiId: projectRootId(caller.projectId, root.key),
              checkout: root.checkout ?? root.path,
              writable: root.writable,
            },
          },
        ],
  );
  if (roots.length === 0) return yield* invalid("None of this project's folders is on disk.");
  return {
    roots,
    wikis: yield* WikiService.WikiService,
    path: yield* Path.Path,
    author: {
      actor: caller.modelSelection.model ?? "Agent",
      threadId: scope.thread?.threadId ?? null,
    },
  } satisfies Access;
});

/** A folder by its key, its name, or its path or the thread's checkout of it. */
const findRoot = ({ path, roots }: Access, repository: string) => {
  const wanted = repository.trim();
  const at = path.isAbsolute(wanted) ? path.resolve(wanted) : null;
  return (
    roots.find((root) => root.key === wanted) ??
    roots.find((root) => root.name.toLowerCase() === wanted.toLowerCase()) ??
    roots.find((root) =>
      [root.path, root.checkout].some((folder) => folder !== null && path.resolve(folder) === at),
    )
  );
};

/** The deepest folder whose checkout or own folder holds an absolute path, and the path in it. */
const holding = ({ path, roots }: Access, target: string) => {
  let best: { readonly root: Root; readonly path: string } | null = null;
  for (const root of roots) {
    for (const folder of new Set([root.read.checkout, root.path])) {
      if (!isWithinRoot(path, target, folder)) continue;
      const relative = path.relative(folder, target).split(path.sep).join("/");
      if (best === null || relative.length < best.path.length) best = { root, path: relative };
    }
  }
  return best;
};

/**
 * Where a tool's path points: the folder it names (`folder:path`, or an absolute path inside one)
 * or `repository` names, null when neither does, and the path from that folder.
 */
const place = Effect.fn("ProjectDocsToolkit.place")(function* (
  context: Access,
  address: string,
  repository: string | undefined,
) {
  const named = repository === undefined ? null : (findRoot(context, repository) ?? null);
  if (repository !== undefined && named === null) {
    return yield* invalid(
      `The project has no folder ${repository.trim()}. Its folders: ${keys(context.roots)}.`,
    );
  }
  const text = address.trim();
  const parsed = parseRootAddress(
    text,
    context.roots.map((root) => root.key),
  );
  const found =
    parsed.root === null
      ? context.path.isAbsolute(text)
        ? holding(context, text)
        : null
      : {
          root: context.roots.find((root) => root.key === parsed.root)!,
          path: text.slice(parsed.root.length + 1),
        };
  if (found === null) {
    // One folder needs no naming.
    return { root: named ?? (context.roots.length === 1 ? context.roots[0]! : null), path: text };
  }
  if (named !== null && named.key !== found.root.key) {
    return yield* invalid(`${text} is in ${found.root.key}, not ${named.key}.`);
  }
  return found;
});

/**
 * `read` in `root`, or with none in every folder: the one folder that has `what`. Never a guess
 * between several.
 */
const inOneRoot = <A>(
  context: Access,
  root: Root | null,
  what: string,
  read: (root: Root) => Effect.Effect<A, WikiError>,
) => {
  if (root !== null) {
    return read(root).pipe(
      Effect.map((result) => ({ root, result })),
      Effect.mapError(wikiFailure),
    );
  }
  return Effect.gen(function* () {
    const tried = yield* Effect.forEach(context.roots, (each) => Effect.result(read(each)), {
      concurrency: 4,
    });
    const found = tried.flatMap((result, position) =>
      Result.isSuccess(result) ? [{ root: context.roots[position]!, result: result.success }] : [],
    );
    if (found.length === 1) return found[0]!;
    if (found.length > 1) {
      return yield* invalid(
        `${what} is in several of the project's folders: ${found.map(({ root: each }) => each.key).join(", ")}. Name one with repository.`,
      );
    }
    const failures = tried.flatMap((result) => (Result.isFailure(result) ? [result.failure] : []));
    const broken = failures.find((error) => error.reason !== "not-found");
    if (broken !== undefined) return yield* wikiFailure(broken);
    return yield* invalid(`No folder of the project has ${what}.`);
  });
};

/** A result that reports a broken base, with the reminder of how one is written. */
const withSyntax = <A extends object>(result: A, broken: boolean) =>
  broken ? { ...result, syntax: BASE_SYNTAX_REMINDER } : result;

/** The path a transform works on, which names the folder it works in. */
const subjectOf = (transform: WikiAgentTransform) =>
  transform.kind === "rename"
    ? transform.from
    : transform.kind === "canvas"
      ? transform.file
      : transform.map;

const withSubject = (transform: WikiAgentTransform, subject: string): WikiAgentTransform =>
  transform.kind === "rename"
    ? { ...transform, from: subject }
    : transform.kind === "canvas"
      ? { ...transform, file: subject }
      : { ...transform, map: subject };

/** Whether a root has what a transform works on: its document, folder, or skill map. */
const holds = (
  index: ProjectIndex,
  transform: WikiAgentTransform,
  subject: string,
  key: string,
) => {
  const each = index.roots.get(key);
  if (each === undefined) return false;
  if (transform.kind === "rename" && transform.folder === true) {
    const folder = `${subject.replace(/^\/+|\/+$/g, "")}/`;
    return [...each.notes.keys(), ...each.canvases.keys(), ...each.bases.keys()].some((file) =>
      file.startsWith(folder),
    );
  }
  if (transform.kind === "rename" || transform.kind === "canvas") {
    return lookupProjectDocument(index, subject, key, key).kind === "found";
  }
  return findMap(each, subject) !== undefined;
};

const writableKeys = (roots: ReadonlyArray<Root>) => {
  const writable = roots.filter((root) => root.writable);
  return writable.length === 0
    ? "Your thread can write none of the project's folders."
    : `Folders your thread can write: ${keys(writable)}.`;
};

/** The folder a transform writes: the one named, the one holding its subject, else the only writable one. */
const transformRoot = Effect.fn("ProjectDocsToolkit.transformRoot")(function* (
  context: Access,
  transform: WikiAgentTransform,
  placed: { readonly root: Root | null; readonly path: string },
) {
  let root = placed.root;
  if (root === null) {
    const index = yield* context.wikis
      .projectIndex(context.roots.map(({ read }) => read))
      .pipe(Effect.mapError(wikiFailure));
    const holders = context.roots.filter((each) => holds(index, transform, placed.path, each.key));
    if (holders.length > 1) {
      return yield* invalid(
        `${placed.path} is in several of the project's folders: ${keys(holders)}. Name one with repository.`,
      );
    }
    const writable = context.roots.filter((each) => each.writable);
    root = holders[0] ?? (writable.length === 1 ? writable[0]! : null);
    if (root === null) {
      return yield* invalid(
        `Name the folder this change goes in with repository. ${writableKeys(context.roots)}`,
      );
    }
  }
  if (!root.writable) {
    return yield* invalid(`Your thread can't write ${root.key}. ${writableKeys(context.roots)}`);
  }
  return root;
});

/** A commit message for the change, as an amendment would have carried it. */
const describe = (transform: WikiAgentTransform) =>
  transform.kind === "rename"
    ? `Move ${transform.from.trim()} to ${transform.to.trim()}`
    : transform.kind === "canvas"
      ? `Change ${transform.file.trim()}`
      : `Change ${transform.map}`;

const addresses = (root: string, files: ReadonlyArray<string>) =>
  files.map((file) => projectAddress({ root, file }));

export const layer = McpToolAccess.toLayer(ProjectDocsToolkit, {
  // Reads see the calling thread's checkout of each folder as it stands, unsaved edits included.
  astrolabe_project_orient: McpToolAccess.reads(({ map, repository }) =>
    Effect.gen(function* () {
      const context = yield* access();
      const placed = yield* place(context, map, repository);
      const { root, result } = yield* inOneRoot(context, placed.root, placed.path, (each) =>
        context.wikis.orient({
          wikiId: each.read.wikiId,
          checkout: each.read.checkout,
          map: placed.path,
        }),
      );
      return { repository: root.key, ...result };
    }),
  ),
  astrolabe_project_links: McpToolAccess.reads(({ name, repository }) =>
    Effect.gen(function* () {
      const context = yield* access();
      const placed = yield* place(context, name, repository);
      const index = yield* context.wikis
        .projectIndex(context.roots.map(({ read }) => read))
        .pipe(Effect.mapError(wikiFailure));
      const found = lookupProjectDocument(
        index,
        placed.path,
        placed.root?.key ?? null,
        context.roots[0]!.key,
      );
      if (found.kind === "ambiguous") {
        return yield* invalid(
          `${placed.path} is in several of the project's folders: ${found.matches.map(projectAddress).join(", ")}. Name one as folder:path.`,
        );
      }
      return projectLinksResult(index, found.file);
    }),
  ),
  astrolabe_project_query: McpToolAccess.reads(({ base, view, repository }) =>
    Effect.gen(function* () {
      const context = yield* access();
      const placed = yield* place(context, base, repository);
      const { root, result } = yield* inOneRoot(context, placed.root, placed.path, (each) =>
        context.wikis
          .query(
            {
              wikiId: each.read.wikiId,
              checkout: each.read.checkout,
              base: placed.path,
              ...(view === undefined ? {} : { view: view.trim() }),
            },
            context.roots.map(({ read }) => read),
          )
          .pipe(
            Effect.mapError((error) =>
              error.cause instanceof BaseError
                ? new WikiError({ ...error, message: `${error.message}\n${BASE_SYNTAX_REMINDER}` })
                : error,
            ),
          ),
      );
      // The property picker's list is for the app; an agent reads the base's YAML instead.
      const { properties: _properties, ...rows } = result;
      return withSyntax({ ...rows, repository: root.key }, rows.warnings !== undefined);
    }),
  ),
  // Written uncommitted into the calling thread's checkout; only a live thread may write.
  astrolabe_project_transform: McpToolAccess.actsAsCaller(({ transform, repository }) =>
    Effect.gen(function* () {
      const context = yield* access();
      const placed = yield* place(context, subjectOf(transform), repository);
      const root = yield* transformRoot(context, transform, placed);
      const change = withSubject(transform, placed.path);
      if (change.kind === "rename") {
        const to = change.to.trim();
        const destination = parseRootAddress(
          to,
          context.roots.map((each) => each.key),
        );
        if (destination.root !== null && destination.root !== root.key) {
          return yield* invalid(
            `A rename stays in its folder: ${placed.path} is in ${root.key}, and ${to} names ${destination.root}.`,
          );
        }
        const moved = yield* context.wikis
          .projectRename({
            roots: context.roots.map(({ read }) => read),
            root: root.key,
            transform: {
              ...change,
              to: destination.root === null ? to : to.slice(destination.root.length + 1),
            },
          })
          .pipe(Effect.mapError(wikiFailure));
        return {
          repository: root.key,
          written: moved.changed.flatMap((each) => addresses(each.root, each.written)),
          removed: moved.changed.flatMap((each) => addresses(each.root, each.removed)),
          errors: moved.changed[0]?.errors ?? [],
          ...(moved.unchanged.length === 0
            ? {}
            : {
                unchanged: moved.unchanged.map((each) => ({
                  repository: each.root,
                  files: each.files,
                })),
              }),
        };
      }
      const written = yield* context.wikis
        .transformCheckout(
          {
            wikiId: root.read.wikiId,
            checkout: root.read.checkout,
            message: describe(change),
            transform: change,
          },
          context.author,
        )
        .pipe(Effect.mapError(wikiFailure));
      if (!("written" in written)) return yield* invalid("The change did not reach the checkout.");
      return {
        repository: root.key,
        written: addresses(root.key, written.written),
        removed: addresses(root.key, written.removed),
        errors: written.errors,
        ...(written.canvas === undefined ? {} : { canvas: written.canvas }),
      };
    }),
  ),
});
