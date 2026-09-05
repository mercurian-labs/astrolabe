import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PlanTurnId } from "@t3tools/contracts";

import { readSpecBody, refreshSpecMarkdown, specRevision } from "./markdown.ts";

import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { CommitId } from "../commitTree/schema.ts";

import { harness, input, base, planId, threadId } from "./testHarness.ts";

it.effect("does not write unchanged upstream, even when local content changed", () => {
  const h = harness();
  h.state.contents = refreshSpecMarkdown(
    h.state.contents,
    "Local",
    "Local criteria",
    specRevision(base.goal, base.acceptanceCriteria),
  );
  return Effect.gen(function* () {
    const refresh = yield* h.setup;
    assert.deepStrictEqual(yield* refresh(input), { kind: "unchanged" });
    assert.strictEqual(h.state.writes, 0);
    assert.strictEqual(h.state.captures, 0);
  }).pipe(Effect.provide(h.layer));
});
it.effect("reconciles both changes and refuses an outdated confirmation", () => {
  const h = harness();
  h.state.title = "Upstream";
  h.state.contents = refreshSpecMarkdown(
    h.state.contents,
    "Local",
    "Local criteria",
    specRevision(base.goal, base.acceptanceCriteria),
  );
  return Effect.gen(function* () {
    const refresh = yield* h.setup;
    const review = yield* refresh(input);
    assert.strictEqual(review.kind, "reconciliation-required");
    if (review.kind !== "reconciliation-required") return;
    h.state.contents += "\n# Notes\nKeep these\n";
    const moved = yield* refresh({
      ...input,
      expectedHash: review.expectedHash,
      reviewedUpstream: review.upstream,
      resolvedDocument: review.local,
    });
    assert.strictEqual(moved.kind, "reconciliation-required");
    assert.strictEqual(h.state.writes, 0);
    if (moved.kind !== "reconciliation-required") return;
    assert.strictEqual(
      (yield* refresh({
        ...input,
        expectedHash: moved.expectedHash,
        reviewedUpstream: moved.upstream,
        resolvedDocument: moved.local,
      })).kind,
      "saved",
    );
    assert.deepStrictEqual(readSpecBody(h.state.contents), moved.local);
    assert.ok(h.state.contents.includes("Keep these"));
    assert.deepStrictEqual(yield* refresh(input), { kind: "unchanged" });
    assert.strictEqual(h.state.activities, 1);
  }).pipe(Effect.provide(h.layer));
});
it.effect("finishes a failed snapshot on retry without repeating the write", () => {
  const h = harness();
  h.state.title = "Upstream";
  h.state.failCapture = true;
  return Effect.gen(function* () {
    const refresh = yield* h.setup;
    yield* Effect.flip(refresh(input));
    assert.strictEqual(h.state.writes, 1);
    h.state.failCapture = false;
    assert.strictEqual((yield* refresh(input)).kind, "saved");
    assert.strictEqual(h.state.writes, 1);
    assert.strictEqual(h.state.captures, 2);
    assert.strictEqual(h.state.released, 2);
  }).pipe(Effect.provide(h.layer));
});
it.effect("refuses refresh while an assistant owns the line", () => {
  const h = harness();
  return Effect.gen(function* () {
    const refresh = yield* h.setup;
    const turns = yield* PlanTurnRegistry;
    yield* turns.open({
      planId,
      threadId,
      turnId: PlanTurnId.make("active"),
      parentCommitId: CommitId.make("later"),
      tipCommitId: CommitId.make("later"),
    });
    yield* Effect.flip(refresh(input));
    assert.strictEqual(h.state.writes, 0);
    assert.strictEqual(h.state.released, 0);
  }).pipe(Effect.provide(h.layer));
});
