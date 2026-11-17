import { CommandId, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { editedFileUndone, latestTurnCheckpoint } from "./EditedFilesNote.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

export class EditedFileCheckError extends Schema.TaggedError<EditedFileCheckError>()(
  "EditedFileCheckError",
  { threadId: Schema.String, cause: Schema.Defect() },
) {}

/**
 * Astrolabe: after the user saves a file, drops its edit from the thread when the file reads as
 * the latest finished turn left it, the base the next prompt's note diffs from.
 */
export class EditedFileCheck extends Context.Reference<{
  readonly check: (input: {
    readonly threadId: ThreadId;
    readonly commandId: CommandId;
    readonly path: string;
    readonly editedAt: DateTime.Utc;
  }) => Effect.Effect<void, EditedFileCheckError>;
}>("t3/orchestration-v2/EditedFileCheck", {
  defaultValue: () => ({ check: () => Effect.void }),
}) {}

export const layer = Layer.effect(
  EditedFileCheck,
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const git = Option.getOrNull(yield* Effect.serviceOption(GitVcsDriver.GitVcsDriver));
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return {
      check: Effect.fn("EditedFileCheck.check")(
        function* (input) {
          const { thread, checkpoints, checkpointScopes } = yield* threads.getThreadRecords(
            input.threadId,
            ["checkpoints", "checkpointScopes"],
          );
          const edit = thread.editedFiles?.find((file) => file.path === input.path);
          if (edit === undefined || !DateTime.Equivalence(edit.editedAt, input.editedAt)) return;
          const cwd =
            thread.worktreePath ??
            Option.getOrUndefined(yield* projects.get(thread.projectId))?.workspaceRoot;
          if (cwd === undefined) return;
          const undone = yield* editedFileUndone(
            {
              cwd,
              path: input.path,
              checkpoint: latestTurnCheckpoint(
                checkpoints,
                checkpointScopes,
                cwd,
                Number.POSITIVE_INFINITY,
              ),
            },
            git,
          );
          if (!undone) return;
          yield* threads.dispatch({
            type: "thread.file-edit.clear",
            commandId: CommandId.make(`${input.commandId}:file-edit-clear`),
            threadId: input.threadId,
            path: input.path,
            editedAt: input.editedAt,
          });
        },
        (effect, input) =>
          effect.pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
            Effect.mapError(
              (cause) => new EditedFileCheckError({ threadId: input.threadId, cause }),
            ),
          ),
      ),
    };
  }),
);
