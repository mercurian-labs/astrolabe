import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { MercurianProjectId, MercurianRepositoryId, ThreadId } from "@t3tools/contracts";
import { DocumentStore, layer } from "./DocumentStore.ts";
import { layerMemory } from "../persistence/Sqlite.ts";

it.layer(layer.pipe(Layer.provide(layerMemory)))("Document operation records", (it) => {
  it.effect(
    "keeps import identity and immutable baselines while recovering an interrupted write",
    () =>
      Effect.gen(function* () {
        const store = yield* DocumentStore;
        const origin = {
          documentId: "issue-1",
          projectId: MercurianProjectId.make("project"),
          repositoryId: MercurianRepositoryId.make("repo"),
          relativePath: "specs/issue.md",
          connectionId: "tracker",
          issueId: "1",
          issueUrl: "https://example.com/1",
          imported: false,
          goal: "Goal",
          acceptanceCriteria: "Criteria",
        };
        assert.deepStrictEqual(yield* store.reserve(origin), origin);
        assert.deepStrictEqual(
          yield* store.reserve({ ...origin, relativePath: "elsewhere.md" }),
          origin,
        );
        yield* store.saveBaseline(origin.documentId, "revision-1", origin);
        yield* store.saveBaseline(origin.documentId, "revision-1", {
          goal: "Do not overwrite",
          acceptanceCriteria: "",
        });
        assert.deepStrictEqual(
          Option.getOrThrow(yield* store.baseline(origin.documentId, "revision-1")),
          { goal: "Goal", acceptanceCriteria: "Criteria" },
        );
        const threadId = ThreadId.make("thread");
        const operation = {
          repositoryId: origin.repositoryId,
          relativePath: origin.relativePath,
          beforeHash: "before",
          contents: "reviewed markdown",
        };
        yield* store.stage(threadId, origin.documentId, operation);
        assert.deepStrictEqual(
          Option.getOrThrow(yield* store.pending(threadId, origin.documentId)),
          operation,
        );
        assert.ok(Option.isNone(yield* store.pending(ThreadId.make("fork"), origin.documentId)));
        yield* store.markImported(origin.documentId);
        assert.strictEqual(Option.getOrThrow(yield* store.get(origin.documentId)).imported, true);
        yield* store.complete(threadId, origin.documentId);
        assert.ok(Option.isNone(yield* store.pending(threadId, origin.documentId)));
        assert.ok(Option.isSome(yield* store.baseline(origin.documentId, "revision-1")));
      }),
  );
});
