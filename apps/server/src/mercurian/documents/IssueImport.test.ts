import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as DateTime from "effect/DateTime";
import { TrackerConnectionId, TrimmedNonEmptyString } from "@t3tools/contracts";
import { harness, planId, projectId, repositoryId, root } from "./testHarness.ts";
import { make } from "./IssueImport.ts";
import { PlanningStore } from "../planning/PlanningStore.ts";
import { StorageSourceStore } from "../storage/StorageSourceStore.ts";
import { LineRuntimeService } from "../lineRuntimes/LineRuntimeService.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { readDocumentMarkdown } from "./markdown.ts";

it.effect(
  "recovers an import after snapshot failure and reopens it after location removal without rewriting",
  () => {
    const h = harness();
    h.state.contents = "";
    h.state.failCapture = true;
    let configured = true;
    const now = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
    const layer = Layer.mergeAll(
      h.layer,
      Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.makeNoop({ exists: () => Effect.sync(() => h.state.contents !== "") }),
      ),
      Layer.mock(StorageSourceStore)({
        getSource: () =>
          Effect.sync(() =>
            configured
              ? Option.some({
                  projectId,
                  repositoryId,
                  kind: "spec",
                  subpath: "specs",
                  createdAt: now,
                  updatedAt: now,
                })
              : Option.none(),
          ),
      }),
      Layer.mock(PlanningStore)({
        getProject: () => Effect.succeed({ projectId } as never),
        importPlan: () =>
          Effect.succeed({
            outcome: "created",
            detail: { plan: { planId, projectId }, timeline: [{ commitId: root }] },
          } as never),
      }),
    );
    // Import and refresh use the same worktree service, with import also ensuring its root runtime.
    const program = Effect.gen(function* () {
      const service = yield* LineRuntimeService;
      const runtimes = yield* LineRuntimeStore;
      const runtime = Option.getOrThrow(yield* runtimes.getByThreadId(hThread));
      const importing = yield* make.pipe(
        Effect.provideService(LineRuntimeService, {
          ...service,
          ensureThread: () => Effect.succeed(runtime),
        }),
      );
      const input = {
        projectId,
        connectionId: TrackerConnectionId.make("tracker"),
        issue: {
          id: TrimmedNonEmptyString.make("1"),
          title: "Imported issue",
          description: "Criteria",
          url: TrimmedNonEmptyString.make("https://example.com/1"),
          status: "Open",
        },
      };
      yield* Effect.flip(importing(input));
      assert.strictEqual(h.state.writes, 1);
      assert.ok(readDocumentMarkdown(h.state.contents, "issue.md").metadata?.id);
      h.state.failCapture = false;
      yield* importing(input);
      assert.strictEqual(h.state.writes, 1);
      assert.strictEqual(h.state.captures, 2);
      configured = false;
      yield* importing({ ...input, issue: { ...input.issue, title: "Changed upstream title" } });
      assert.strictEqual(h.state.writes, 1);
      assert.strictEqual(h.state.captures, 2);
    });
    return program.pipe(Effect.provide(layer));
  },
);
import { threadId as hThread } from "./testHarness.ts";
