import { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as PreviewManager from "../preview/Manager.ts";
import { removeThreadProviderEventLogs } from "../provider/EventNdjsonLogger.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";

export class ResourceCleanupError extends Schema.TaggedError<ResourceCleanupError>()(
  "ResourceCleanupError",
  {
    operation: Schema.Literals([
      "terminal",
      "preview",
      "attachment",
      "scheduled-tasks",
      "checkpoint-refs",
      "provider-logs",
      "thread-records",
    ]),
    threadId: Schema.optional(Schema.String),
    attachmentId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export class ResourceCleanupService extends Context.Reference<{
  readonly cleanupScheduledTasks: (threadId: ThreadId) => Effect.Effect<void, ResourceCleanupError>;
  readonly cleanupTerminals: (threadId: string) => Effect.Effect<void, ResourceCleanupError>;
  readonly cleanupPreviews: (threadId: string) => Effect.Effect<void, ResourceCleanupError>;
  readonly cleanupAttachments: (
    attachmentIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, ResourceCleanupError>;
  /**
   * Erases a deleted thread's history, checkpoint refs and provider logs, then
   * any deleted ancestors this thread was the last live reader of.
   */
  readonly purgeThread: (threadId: ThreadId) => Effect.Effect<void, ResourceCleanupError>;
}>("t3/orchestration-v2/ResourceCleanupService", {
  defaultValue: () => ({
    cleanupScheduledTasks: () => Effect.void,
    cleanupTerminals: () => Effect.void,
    cleanupPreviews: () => Effect.void,
    cleanupAttachments: () => Effect.void,
    purgeThread: () => Effect.void,
  }),
}) {}

export const layer = Layer.effect(
  ResourceCleanupService,
  Effect.gen(function* () {
    const terminals = yield* TerminalManager.TerminalManager;
    const previews = yield* PreviewManager.PreviewManager;
    const fileSystem = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const checkpointStore = yield* CheckpointStore.CheckpointStore;

    // Refs and logs before the records: the refs are found through the
    // records, so a retry after a crash still finds them.
    const purgeOne = Effect.fn("ResourceCleanupService.purgeOne")(function* (
      threadId: ThreadId,
      plan: ProjectionMaintenance.ThreadPurgePlan,
    ) {
      for (const group of plan.checkpointRefs) {
        const cwd = yield* Effect.findFirst(group.cwds, (cwd) =>
          fileSystem.exists(cwd).pipe(Effect.orElseSucceed(() => false)),
        );
        // No checkout left means the refs went with the repository.
        if (Option.isNone(cwd)) continue;
        yield* checkpointStore
          .deleteCheckpointRefs({ cwd: cwd.value, checkpointRefs: group.refs })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ResourceCleanupError({ operation: "checkpoint-refs", threadId, cause }),
            ),
          );
      }
      yield* removeThreadProviderEventLogs(config.providerEventLogPath, threadId).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.mapError(
          (cause) => new ResourceCleanupError({ operation: "provider-logs", threadId, cause }),
        ),
      );
      yield* maintenance
        .purgeThread(threadId)
        .pipe(
          Effect.mapError(
            (cause) => new ResourceCleanupError({ operation: "thread-records", threadId, cause }),
          ),
        );
    });

    const purgeThread = Effect.fn("ResourceCleanupService.purgeThread")(function* (
      threadId: ThreadId,
    ) {
      const visited = new Set<ThreadId>();
      let next: ThreadId | null = threadId;
      while (next !== null && !visited.has(next)) {
        visited.add(next);
        const current: ThreadId = next;
        const plan = yield* maintenance
          .readThreadPurge(current)
          .pipe(
            Effect.mapError(
              (cause) =>
                new ResourceCleanupError({ operation: "thread-records", threadId: current, cause }),
            ),
          );
        // A live thread, or one a live fork or subagent still reads: its own
        // deletion, or its last reader's, purges it later.
        if (Option.isNone(plan)) return;
        yield* purgeOne(current, plan.value);
        next = plan.value.parentThreadId;
      }
    });

    return {
      purgeThread,
      cleanupScheduledTasks: (threadId: ThreadId) =>
        scheduledTasks
          .deleteForThread(threadId)
          .pipe(
            Effect.mapError(
              (cause) =>
                new ResourceCleanupError({ operation: "scheduled-tasks", threadId, cause }),
            ),
          ),
      cleanupTerminals: (threadId: string) =>
        terminals
          .close({ threadId, deleteHistory: true })
          .pipe(
            Effect.mapError(
              (cause) => new ResourceCleanupError({ operation: "terminal", threadId, cause }),
            ),
          ),
      cleanupPreviews: (threadId: string) =>
        previews
          .close({ threadId: ThreadId.make(threadId) })
          .pipe(
            Effect.mapError(
              (cause) => new ResourceCleanupError({ operation: "preview", threadId, cause }),
            ),
          ),
      cleanupAttachments: (attachmentIds: ReadonlyArray<string>) =>
        Effect.forEach(
          attachmentIds,
          (attachmentId) => {
            const path = resolveAttachmentPathById({
              attachmentsDir: config.attachmentsDir,
              attachmentId,
            });
            return path === null
              ? Effect.void
              : fileSystem
                  .remove(path, { force: true })
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new ResourceCleanupError({ operation: "attachment", attachmentId, cause }),
                    ),
                  );
          },
          { discard: true, concurrency: 4 },
        ),
    };
  }),
);
