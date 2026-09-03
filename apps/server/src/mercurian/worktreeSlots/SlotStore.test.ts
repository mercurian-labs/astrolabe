import { assert, it } from "@effect/vitest";
import { MercurianCommitId, MercurianProjectId, MercurianRepositoryId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as SlotStore from "./SlotStore.ts";
import { WorktreeSlotId } from "./schema.ts";

const layer = it.layer(SlotStore.layer.pipe(Layer.provideMerge(MercurianSqlite.layerMemory)));
const at = DateTime.makeUnsafe("2026-08-31T12:00:00.000Z");

layer("SlotStore", (it) => {
  it.effect("round-trips project slots and assigns every repository member together", () =>
    Effect.gen(function* () {
      const store = yield* SlotStore.SlotStore;
      const projectId = MercurianProjectId.make("project");
      const otherProjectId = MercurianProjectId.make("other-project");
      const slotId = WorktreeSlotId.make("project:slot-1");
      const repositoryA = MercurianRepositoryId.make("repository-a");
      const repositoryB = MercurianRepositoryId.make("repository-b");
      yield* store.create({
        slotId,
        projectId,
        path: "/worktrees/project/slot-1",
        currentLineRootCommitId: MercurianCommitId.make("line-a"),
        members: [
          { repositoryId: repositoryA, relativePath: "apps/a", currentBranch: "line-a-a" },
          { repositoryId: repositoryB, relativePath: "apps/b", currentBranch: "line-a-b" },
        ],
        createdAt: at,
        lastUsedAt: at,
      });

      assert.strictEqual((yield* store.list(projectId)).length, 1);
      assert.strictEqual((yield* store.list(otherProjectId)).length, 0);
      const before = yield* store.get(slotId);
      assert.ok(Option.isSome(before));
      assert.deepStrictEqual(
        before.value.members.map((member) => member.relativePath),
        ["apps/a", "apps/b"],
      );

      yield* store.assign({
        slotId,
        lineRootCommitId: MercurianCommitId.make("line-b"),
        members: [
          { repositoryId: repositoryA, currentBranch: "line-b-a" },
          { repositoryId: repositoryB, currentBranch: "line-b-b" },
        ],
        lastUsedAt: DateTime.makeUnsafe("2026-08-31T13:00:00.000Z"),
      });
      const after = Option.getOrThrow(yield* store.get(slotId));
      assert.strictEqual(after.currentLineRootCommitId, "line-b");
      assert.deepStrictEqual(
        after.members.map((member) => member.currentBranch),
        ["line-b-a", "line-b-b"],
      );
      yield* store.updateMemberBranch({
        slotId,
        repositoryId: repositoryA,
        currentBranch: "line-b-a-renamed",
      });
      const renamed = Option.getOrThrow(yield* store.get(slotId));
      assert.deepStrictEqual(
        renamed.members.map((member) => member.currentBranch),
        ["line-b-a-renamed", "line-b-b"],
      );
    }),
  );
});
