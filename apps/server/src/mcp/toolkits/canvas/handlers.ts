import {
  canvasDocument,
  canvasDrawingProblems,
  canvasEmbeds,
  canvasFileName,
  type CanvasData,
} from "@mercurian/wiki/canvas";
import {
  type CanvasShowCode,
  OrchestratorMcpFailure,
  parseRootAddress,
  type ProjectRootCheckout,
  type RootKey,
  ThreadId,
  TurnItemId,
  type WikiError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as CanvasKeep from "../../../wiki/CanvasKeep.ts";
import { layoutCanvas } from "../../../wiki/CanvasLayout.ts";
import * as ProjectRoots from "../../../workspace/ProjectRoots.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import { loadCaller, readThread, unavailable } from "../../threadAccess.ts";
import { CanvasToolkit, canvasShownMessage } from "./tools.ts";

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const keepFailure = (error: WikiError) =>
  error.reason === "git-failed" || error.reason === "git-unavailable"
    ? unavailable()
    : invalid(error.message);

interface CodeCards {
  /** Each folder the cards cite, by key, at the commit its checkout stood at. */
  readonly codes: Readonly<Record<RootKey, CanvasShowCode>>;
  /** The project folder's entry in `codes`. */
  readonly code: CanvasShowCode | undefined;
  /** The project's keys, project folder first, which `folder:path` cards are read by. */
  readonly keys: ReadonlyArray<RootKey>;
}

/**
 * Checks each code card's file is in the thread's checkout of its folder, and finds what commit a
 * kept card should pin each folder's files to.
 */
const readCode = Effect.fn("CanvasTools.readCode")(function* (paths: ReadonlyArray<string>) {
  const { caller } = yield* loadCaller();
  if (caller === undefined) return yield* unavailable();
  const projects = yield* ProjectService.ProjectService;
  const project = yield* projects.getById(caller.projectId).pipe(Effect.mapError(unavailable));
  if (Option.isNone(project)) return yield* invalid("This thread's project was not found.");
  const addresses = [...new Set(paths)];
  const { roots, paths: resolved } = yield* (yield* ProjectRoots.ProjectRoots)
    .resolveAll({
      projectId: caller.projectId,
      worktreePath: caller.worktreePath,
      addresses,
    })
    .pipe(Effect.mapError((error) => invalid(error.message)));

  const fileSystem = yield* FileSystem.FileSystem;
  const found = yield* Effect.forEach(
    resolved,
    (each, index) =>
      (each.absolutePath === null
        ? Effect.succeed(false)
        : fileSystem.exists(each.absolutePath).pipe(Effect.orElseSucceed(() => false))
      ).pipe(Effect.map((exists) => ({ address: addresses[index]!, root: each.root, exists }))),
    { concurrency: 8 },
  );
  const missing = found.filter((each) => !each.exists).map((each) => each.address);
  if (missing.length > 0) {
    return yield* invalid(`These files aren't in this checkout: ${missing.join(", ")}`);
  }

  const git = yield* GitVcsDriver.GitVcsDriver;
  const cited = [...new Map(found.map(({ root }) => [root.key, root]))];
  const read = Effect.fnUntraced(function* (root: ProjectRootCheckout) {
    const head = yield* git
      .execute({
        operation: "CanvasTools.readCode",
        cwd: root.checkout ?? root.path,
        args: ["rev-parse", "--verify", "HEAD"],
      })
      .pipe(Effect.option);
    if (Option.isNone(head)) return undefined;
    const identity = yield* projects.readRepositoryIdentity(
      root.kind === "workspace" ? project.value : { workspaceRoot: root.path },
    );
    return {
      commit: head.value.stdout.trim(),
      ...(identity ? { repository: identity.canonicalKey } : {}),
      ...(identity?.webUrl ? { webUrl: identity.webUrl } : {}),
    } satisfies CanvasShowCode;
  });
  const codes: Record<RootKey, CanvasShowCode> = {};
  for (const [key, root] of cited) {
    const code = yield* read(root);
    if (code !== undefined) codes[key] = code;
  }
  const workspace = roots.find((root) => root.kind === "workspace");
  return {
    codes,
    code: workspace === undefined ? undefined : codes[workspace.key],
    keys: roots.map((root) => root.key),
  } satisfies CodeCards;
});

/**
 * A `folder:path` card keeps its folder beside its path, and one naming the project folder reads
 * as the bare path older clients open; a bare path stays as the agent wrote it.
 */
const withCodeRoots = (board: CanvasData, keys: ReadonlyArray<RootKey>): CanvasData => ({
  ...board,
  nodes: board.nodes.map((node) => {
    const code = node.type === "link" ? node.astrolabe?.code : undefined;
    if (node.type !== "link" || code === undefined) return node;
    const address = parseRootAddress(code.path, keys);
    if (address.root === null) return node;
    const path = code.path.slice(address.root.length + 1);
    return {
      ...node,
      astrolabe: {
        ...node.astrolabe,
        code: { ...code, path, ...(address.root === keys[0] ? {} : { root: address.root }) },
      },
    };
  }),
});

export const layer = McpToolAccess.toLayer(CanvasToolkit, {
  // The call is the record: clients draw it from the thread, and nothing is stored here.
  astrolabe_canvas_show: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const problems = canvasDrawingProblems(input);
      if (problems.length > 0) return yield* invalid(problems.join(" "));
      const paths = input.cards.flatMap((card) => card.path ?? []);
      const cited = paths.length > 0 ? yield* readCode(paths) : undefined;
      const code = cited?.code;
      const codes =
        cited === undefined || Object.keys(cited.codes).length === 0 ? undefined : cited.codes;
      // Laid out once, here: the board never moves after, whatever the engine becomes.
      const laid = yield* layoutCanvas(input);
      const board = cited === undefined ? laid : withCodeRoots(laid, cited.keys);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      const recorded = yield* service
        .recordCanvas(scope, {
          title: input.title,
          ...(input.update === undefined ? {} : { update: input.update }),
          document: canvasDocument(board),
          code,
        })
        .pipe(
          Effect.catchIf(
            (error) => error.code !== "invalid_request",
            (error) =>
              Effect.logWarning("A canvas was shown without its layout recorded", {
                error: error.message,
              }).pipe(Effect.as(undefined)),
          ),
        );
      if (recorded === undefined) {
        return {
          message: "Shown to the reader below your reply.",
          ...(code === undefined ? {} : { code }),
          ...(codes === undefined ? {} : { codes }),
        };
      }
      const file = canvasFileName(recorded.title);
      const embeds = canvasEmbeds(file, board);
      return {
        message: canvasShownMessage(
          file,
          recorded.updated === true,
          recorded.replacedUserEdits === true,
        ),
        canvasItemId: recorded.turnItemId,
        file,
        embeds,
        ...(code === undefined ? {} : { code }),
        ...(codes === undefined ? {} : { codes }),
      };
    }),
  ),
  astrolabe_canvas_keep: McpToolAccess.actsAsCaller(
    ({ repository, name, itemId, threadId, comment }) =>
      Effect.gen(function* () {
        const { caller, scope, projection } = yield* readThread(
          threadId === undefined ? undefined : ThreadId.make(threadId.trim()),
        );
        if (caller === undefined) {
          return yield* invalid("Keep a canvas from a thread: it lands in that thread's project.");
        }
        const keeper = yield* CanvasKeep.CanvasKeep;
        const trimmed = comment?.trim();
        const folder = repository?.trim();
        return yield* keeper
          .keep(
            {
              projectId: caller.projectId,
              ...(folder ? { repository: folder } : {}),
              threadId: projection.thread.id,
              itemId: TurnItemId.make(itemId.trim()),
              name: name.trim(),
              ...(trimmed ? { comment: trimmed } : {}),
            },
            {
              actor: caller.modelSelection.model ?? "Agent",
              threadId: scope.thread?.threadId ?? null,
            },
          )
          .pipe(Effect.mapError(keepFailure));
      }),
  ),
});
