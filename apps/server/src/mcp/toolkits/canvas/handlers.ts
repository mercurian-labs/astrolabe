import { canvasDrawingProblems } from "@mercurian/wiki/canvas";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, unavailable } from "../../threadAccess.ts";
import { CanvasToolkit } from "./tools.ts";

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/** Checks a code card's files exist, and finds what commit a kept card should pin them to. */
const readCode = Effect.fn("CanvasTools.readCode")(function* (paths: ReadonlyArray<string>) {
  const { caller } = yield* loadCaller();
  if (caller === undefined) return yield* unavailable();
  const projects = yield* ProjectService.ProjectService;
  const project = yield* projects.getById(caller.projectId).pipe(Effect.mapError(unavailable));
  if (Option.isNone(project)) return yield* invalid("This thread's project was not found.");
  const cwd = caller.worktreePath ?? project.value.workspaceRoot;

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const missing = yield* Effect.filter(
    [...new Set(paths)],
    (file) =>
      fileSystem.exists(path.join(cwd, file)).pipe(
        Effect.map((exists) => !exists),
        Effect.orElseSucceed(() => true),
      ),
    { concurrency: 8 },
  );
  if (missing.length > 0) {
    return yield* invalid(`These files aren't in this checkout: ${missing.join(", ")}`);
  }

  const git = yield* GitVcsDriver.GitVcsDriver;
  const head = yield* git
    .execute({
      operation: "CanvasTools.readCode",
      cwd,
      args: ["rev-parse", "--verify", "HEAD"],
    })
    .pipe(Effect.option);
  if (Option.isNone(head)) return undefined;
  const identity = project.value.repositoryIdentity;
  return {
    commit: head.value.stdout.trim(),
    ...(identity ? { repository: identity.canonicalKey } : {}),
    ...(identity?.webUrl ? { webUrl: identity.webUrl } : {}),
  };
});

export const layer = McpToolAccess.toLayer(CanvasToolkit, {
  // The call is the record: clients draw it from the thread, and nothing is stored here.
  astrolabe_canvas_show: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const problems = canvasDrawingProblems(input);
      if (problems.length > 0) return yield* invalid(problems.join(" "));
      const paths = input.cards.flatMap((card) => card.path ?? []);
      const code = paths.length > 0 ? yield* readCode(paths) : undefined;
      return {
        message:
          "Shown to the reader above your reply. Don't describe it; reply with only what it doesn't already say.",
        ...(code === undefined ? {} : { code }),
      };
    }),
  ),
});
