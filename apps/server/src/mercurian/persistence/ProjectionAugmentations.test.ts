import { assert, it } from "@effect/vitest";
import { MercurianRepositoryId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import { runProjectionAugmentations } from "./ProjectionAugmentations.ts";

const persistence = Layer.provideMerge(
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* runMigrations();
      yield* runProjectionAugmentations();
      yield* runProjectionAugmentations();
    }),
  ),
  NodeSqliteClient.layerMemory(),
);

const layer = it.layer(
  Layer.mergeAll(ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(persistence)), persistence),
);

layer("ProjectionAugmentations", (it) => {
  it.effect("adds workspace members once and the thread repository round-trips them", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const threads = yield* ProjectionThreadRepository;
      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.strictEqual(
        columns.filter((column) => column.name === "workspace_members_json").length,
        1,
      );

      const workspaceMembers = [
        {
          repositoryId: MercurianRepositoryId.make("repository-server"),
          worktreePath: "/tmp/slot/server",
        },
        {
          repositoryId: MercurianRepositoryId.make("repository-web"),
          worktreePath: "/tmp/slot/web",
        },
      ];
      const threadId = ThreadId.make("thread-workspace-members");
      yield* threads.upsert({
        threadId,
        projectId: ProjectId.make("project-workspace-members"),
        title: "Workspace members",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "feature/workspace-members",
        worktreePath: "/tmp/slot/server",
        workspaceMembers,
        latestTurnId: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        unsettledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const persisted = yield* threads.getById({ threadId });
      assert.deepStrictEqual(Option.getOrThrow(persisted).workspaceMembers, workspaceMembers);
    }),
  );
});
