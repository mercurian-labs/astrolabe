import {
  type CodeCheckout,
  type CodeIndexError,
  OrchestratorMcpFailure,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CodeIndex from "../../../codeIndex/CodeIndex.ts";
import { checkpointRefForScopeOrdinal } from "../../../orchestration-v2/CheckpointService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, unavailable } from "../../threadAccess.ts";
import { CodeToolkit } from "./tools.ts";

const FALLBACK = "Use search and file reads instead.";

const codeFailure = (error: CodeIndexError) => {
  switch (error.reason) {
    case "off":
      return new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `The code index is turned off for this repository in Settings. ${FALLBACK}`,
      });
    case "not-indexed":
      return new OrchestratorMcpFailure({
        code: "orchestration_error",
        message:
          "The code index for this repository is still building. Retry in a minute, or use search and file reads.",
      });
    case "unsupported":
      return new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `This project has no code index, or no parser reads this file's language. ${FALLBACK}`,
      });
    case "not-found":
      return new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
    case "git-failed":
    case "failed":
      return new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
  }
};

/** The calling thread and its checkout: the thread's worktree, else the project's own folder. */
const readCheckout = Effect.fn("CodeTools.readCheckout")(function* () {
  const { caller } = yield* loadCaller();
  // readsAsCaller has already refused callers outside a thread.
  if (caller === undefined) return yield* unavailable();
  const projects = yield* ProjectService.ProjectService;
  const project = yield* projects.getById(caller.projectId).pipe(Effect.mapError(unavailable));
  if (Option.isNone(project)) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "This thread's project was not found.",
    });
  }
  const checkout: CodeCheckout = {
    projectId: caller.projectId,
    cwd: caller.worktreePath ?? project.value.workspaceRoot,
  };
  return { threadId: caller.id, checkout };
});

const read = Effect.fn("CodeTools.read")(function* <A>(
  query: (
    index: CodeIndex.CodeIndex["Service"],
    checkout: CodeCheckout,
  ) => Effect.Effect<A, CodeIndexError>,
) {
  const { checkout } = yield* readCheckout();
  const index = yield* CodeIndex.CodeIndex;
  return yield* query(index, checkout).pipe(Effect.mapError(codeFailure));
});

/** The checkpoint before the thread's last finished turn, or before its first turn. */
const latestTurnStart = Effect.fn("CodeTools.latestTurnStart")(function* (threadId: ThreadId) {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const context = yield* threads.getCheckpointContext(threadId).pipe(Effect.mapError(unavailable));
  const latest = context.checkpoints
    .filter((checkpoint) => checkpoint.status === "ready" && checkpoint.appRunOrdinal !== null)
    .reduce<(typeof context.checkpoints)[number] | undefined>(
      (found, checkpoint) =>
        found !== undefined && (found.appRunOrdinal ?? 0) >= (checkpoint.appRunOrdinal ?? 0)
          ? found
          : checkpoint,
      undefined,
    );
  const scopeId =
    latest?.scopeId ?? context.checkpointScopes.find((scope) => scope.kind === "root_run")?.id;
  if (scopeId === undefined) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: 'This thread has no turn checkpoints yet. Pass `since` as "branch" or a git ref.',
    });
  }
  return yield* checkpointRefForScopeOrdinal({
    scopeId,
    ordinalWithinScope: Math.max(0, (latest?.ordinalWithinScope ?? 0) - 1),
  });
});

const branchBase = Effect.fn("CodeTools.branchBase")(function* (cwd: string) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const { mergeBase } = yield* git.resolveBranchMergeBase(cwd).pipe(
    Effect.mapError(
      () =>
        new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Could not find where this branch left its base branch. Pass `since` as a ref.",
        }),
    ),
  );
  return mergeBase;
});

export const layer = McpToolAccess.toLayer(CodeToolkit, {
  astrolabe_code_outline: McpToolAccess.readsAsCaller((input) =>
    read((index, checkout) => index.outline({ ...checkout, ...input })),
  ),
  astrolabe_code_find: McpToolAccess.readsAsCaller((input) =>
    read((index, checkout) => index.find({ ...checkout, ...input })),
  ),
  astrolabe_code_changes: McpToolAccess.readsAsCaller(({ since = "turn" }) =>
    Effect.gen(function* () {
      const { threadId, checkout } = yield* readCheckout();
      const from =
        since === "turn"
          ? yield* latestTurnStart(threadId)
          : since === "branch"
            ? yield* branchBase(checkout.cwd)
            : since;
      const index = yield* CodeIndex.CodeIndex;
      const changes = yield* index
        .changes({ ...checkout, from })
        .pipe(Effect.mapError(codeFailure));
      return { from, ...changes };
    }),
  ),
  astrolabe_code_map: McpToolAccess.readsAsCaller((input) =>
    read((index, checkout) => index.map({ ...checkout, ...input })),
  ),
  // The view is the call itself: the thread keeps it, and its Graph tab draws it from there.
  astrolabe_code_graph_show: McpToolAccess.readsAsCaller(({ steps }) =>
    Effect.gen(function* () {
      const focus = [...new Set(steps.flatMap((step) => step.focus))];
      const ids = [
        ...new Set([
          ...focus,
          ...steps.flatMap((step) => [
            ...(step.links ?? []).flatMap((link) => [link.from, link.to]),
            ...(step.expandNeighbours ?? []),
            ...(step.showContents ?? []),
          ]),
        ]),
      ];
      const { unknown } = yield* read((index, checkout) => index.checkNodes({ ...checkout, ids }));
      if (focus.every((id) => unknown.includes(id))) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `None of the steps' focus nodes are in this checkout: ${focus.join(", ")}. Use paths relative to your working directory, and definition ids from astrolabe_code_outline or astrolabe_code_find.`,
        });
      }
      return { steps: steps.length, unknown: [...unknown] };
    }),
  ),
});
