import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as CommitStore from "./CommitStore.ts";
import {
  type CommitAuthorKind,
  CommitId,
  type CommitKind,
  HistoryId,
  type NewCommit,
} from "./schema.ts";

const layer = it.layer(CommitStore.layer.pipe(Layer.provide(MercurianSqlite.layerMemory)));

const historyId = Schema.decodeUnknownSync(HistoryId);
const commitId = Schema.decodeUnknownSync(CommitId);

const at = DateTime.makeUnsafe("2026-08-02T00:00:00.000Z");

const newCommit = (
  id: string,
  options?: {
    readonly kind?: CommitKind;
    readonly authorKind?: CommitAuthorKind;
    readonly payload?: unknown;
  },
): NewCommit => ({
  commitId: commitId(id),
  kind: options?.kind ?? "message",
  authorKind: options?.authorKind ?? "human",
  createdAt: at,
  payload: options?.payload ?? {},
});

const append = (
  store: CommitStore.CommitStore["Service"],
  history: string,
  id: string,
  parents: ReadonlyArray<string>,
  options?: Parameters<typeof newCommit>[1],
) =>
  store.append({
    ...newCommit(id, options),
    historyId: historyId(history),
    parents: parents.map((parent) => commitId(parent)),
  });

const ids = (commits: ReadonlyArray<{ readonly commitId: string }>) =>
  commits.map((commit) => commit.commitId);

layer("CommitStore", (it) => {
  it.effect("stores forks and n-ary merges, and refuses a second root", () =>
    Effect.gen(function* () {
      const store = yield* CommitStore.CommitStore;

      yield* store.createHistory({
        historyId: historyId("dag"),
        rootCommit: newCommit("dag-root"),
        rootPublished: false,
      });
      // One commit, three children: the fork is the human's to make.
      yield* append(store, "dag", "dag-a", ["dag-root"]);
      yield* append(store, "dag", "dag-b", ["dag-root"]);
      yield* append(store, "dag", "dag-c", ["dag-root"]);
      // Plan in N parts, unify once.
      const merge = yield* append(store, "dag", "dag-m", ["dag-a", "dag-b", "dag-c"]);

      assert.deepStrictEqual([...merge.parents], ["dag-a", "dag-b", "dag-c"]);

      const stored = yield* store.getCommit({ commitId: commitId("dag-m"), visibility: "all" });
      assert.ok(Option.isSome(stored));
      assert.deepStrictEqual([...stored.value.parents], ["dag-a", "dag-b", "dag-c"]);

      const children = yield* store.children({
        commitId: commitId("dag-root"),
        visibility: "all",
      });
      assert.deepStrictEqual(ids(children), ["dag-a", "dag-b", "dag-c"]);

      const ancestors = yield* store.ancestors({
        commitId: commitId("dag-m"),
        visibility: "all",
      });
      assert.deepStrictEqual(ids(ancestors), ["dag-root", "dag-a", "dag-b", "dag-c"]);

      const all = yield* store.listCommits({ historyId: historyId("dag"), visibility: "all" });
      assert.deepStrictEqual(ids(all), ["dag-root", "dag-a", "dag-b", "dag-c", "dag-m"]);

      const history = yield* store.getHistory({ historyId: historyId("dag") });
      assert.ok(Option.isSome(history));

      const secondRoot = yield* append(store, "dag", "dag-root-2", []).pipe(Effect.flip);
      assert.strictEqual(secondRoot._tag, "HistoryRootExistsError");
    }),
  );

  it.effect("rejects cycles: a parent must already exist", () =>
    Effect.gen(function* () {
      const store = yield* CommitStore.CommitStore;

      yield* store.createHistory({
        historyId: historyId("cycle"),
        rootCommit: newCommit("cycle-root"),
        rootPublished: false,
      });
      yield* append(store, "cycle", "cycle-a", ["cycle-root"]);

      const selfParent = yield* append(store, "cycle", "cycle-x", ["cycle-x"]).pipe(Effect.flip);
      assert.strictEqual(selfParent._tag, "CommitParentNotFoundError");

      const unknownParent = yield* append(store, "cycle", "cycle-y", ["nowhere"]).pipe(Effect.flip);
      assert.strictEqual(unknownParent._tag, "CommitParentNotFoundError");

      const duplicateParent = yield* append(store, "cycle", "cycle-z", ["cycle-a", "cycle-a"]).pipe(
        Effect.flip,
      );
      assert.strictEqual(duplicateParent._tag, "CommitParentDuplicateError");

      yield* store.createHistory({
        historyId: historyId("cycle-other"),
        rootCommit: newCommit("cycle-other-root"),
        rootPublished: false,
      });
      const foreignParent = yield* append(store, "cycle", "cycle-w", ["cycle-other-root"]).pipe(
        Effect.flip,
      );
      assert.strictEqual(foreignParent._tag, "CommitParentHistoryMismatchError");
    }),
  );

  it.effect("round-trips both design axes and opaque payloads", () =>
    Effect.gen(function* () {
      const store = yield* CommitStore.CommitStore;

      yield* store.createHistory({
        historyId: historyId("axes"),
        rootCommit: newCommit("axes-root", { payload: { text: "hello" } }),
        rootPublished: false,
      });

      // A linear chain, so the assistant never opens a fork.
      const chain: ReadonlyArray<readonly [string, CommitKind, CommitAuthorKind]> = [
        ["axes-1", "message", "assistant"],
        ["axes-2", "plan-revision", "human"],
        ["axes-3", "plan-revision", "assistant"],
        ["axes-4", "issue-revision", "human"],
        ["axes-5", "issue-revision", "assistant"],
      ];
      let parent = "axes-root";
      for (const [id, kind, authorKind] of chain) {
        yield* append(store, "axes", id, [parent], { kind, authorKind });
        parent = id;
      }
      // Coding sessions are leaves; the assistant takes the tip first so the
      // human's leaf is the fork, not the assistant's.
      yield* append(store, "axes", "axes-6", [parent], {
        kind: "coding-session",
        authorKind: "assistant",
      });
      yield* append(store, "axes", "axes-7", [parent], {
        kind: "coding-session",
        authorKind: "human",
      });

      const all = yield* store.listCommits({ historyId: historyId("axes"), visibility: "all" });
      assert.deepStrictEqual(
        all.map((commit) => [commit.kind, commit.authorKind]),
        [
          ["message", "human"],
          ["message", "assistant"],
          ["plan-revision", "human"],
          ["plan-revision", "assistant"],
          ["issue-revision", "human"],
          ["issue-revision", "assistant"],
          ["coding-session", "assistant"],
          ["coding-session", "human"],
        ],
      );
      assert.deepStrictEqual(all[0]?.payload, { text: "hello" });
    }),
  );

  it.effect("refuses assistant-authored forks and merges as a hard rule", () =>
    Effect.gen(function* () {
      const store = yield* CommitStore.CommitStore;

      const assistantRoot = yield* store
        .createHistory({
          historyId: historyId("assistant-root"),
          rootCommit: newCommit("assistant-root-c", { authorKind: "assistant" }),
          rootPublished: false,
        })
        .pipe(Effect.flip);
      assert.strictEqual(assistantRoot._tag, "AssistantForkError");

      yield* store.createHistory({
        historyId: historyId("rule"),
        rootCommit: newCommit("rule-root"),
        rootPublished: false,
      });
      yield* append(store, "rule", "rule-a", ["rule-root"]);
      yield* append(store, "rule", "rule-b", ["rule-root"]);

      const assistantMerge = yield* append(store, "rule", "rule-m", ["rule-a", "rule-b"], {
        authorKind: "assistant",
      }).pipe(Effect.flip);
      assert.strictEqual(assistantMerge._tag, "AssistantMergeError");

      // `rule-root` already has children, so continuing there opens a second line.
      const assistantFork = yield* append(store, "rule", "rule-f", ["rule-root"], {
        authorKind: "assistant",
      }).pipe(Effect.flip);
      assert.strictEqual(assistantFork._tag, "AssistantForkError");

      const assistantOrphan = yield* append(store, "rule", "rule-o", [], {
        authorKind: "assistant",
      }).pipe(Effect.flip);
      assert.strictEqual(assistantOrphan._tag, "AssistantForkError");

      // The same shapes are the human's to make.
      yield* append(store, "rule", "rule-human-merge", ["rule-a", "rule-b"]);
      yield* append(store, "rule", "rule-human-fork", ["rule-root"]);
    }),
  );

  it.effect("keeps coding sessions as leaves", () =>
    Effect.gen(function* () {
      const store = yield* CommitStore.CommitStore;

      yield* store.createHistory({
        historyId: historyId("leaf"),
        rootCommit: newCommit("leaf-root"),
        rootPublished: false,
      });
      yield* append(store, "leaf", "leaf-session", ["leaf-root"], { kind: "coding-session" });

      const humanChild = yield* append(store, "leaf", "leaf-a", ["leaf-session"]).pipe(Effect.flip);
      assert.strictEqual(humanChild._tag, "CodingSessionParentError");

      const assistantChild = yield* append(store, "leaf", "leaf-b", ["leaf-session"], {
        authorKind: "assistant",
      }).pipe(Effect.flip);
      assert.strictEqual(assistantChild._tag, "CodingSessionParentError");

      const merge = yield* append(store, "leaf", "leaf-c", ["leaf-root"]).pipe(
        Effect.flatMap(() => append(store, "leaf", "leaf-m", ["leaf-session", "leaf-c"])),
        Effect.flip,
      );
      assert.strictEqual(merge._tag, "CodingSessionParentError");

      // A coding session hangs off any branch, it just cannot be built upon.
      yield* append(store, "leaf", "leaf-session-2", ["leaf-c"], { kind: "coding-session" });
    }),
  );

  it.effect("publishing a commit publishes its ancestors along every path", () =>
    Effect.gen(function* () {
      const store = yield* CommitStore.CommitStore;

      yield* store.createHistory({
        historyId: historyId("pub"),
        rootCommit: newCommit("pub-root"),
        rootPublished: false,
      });
      yield* append(store, "pub", "pub-a", ["pub-root"]);
      yield* append(store, "pub", "pub-b", ["pub-root"]);
      yield* append(store, "pub", "pub-m", ["pub-a", "pub-b"]);
      // A sibling that is not an ancestor of the merge stays private.
      yield* append(store, "pub", "pub-side", ["pub-root"]);

      const published = yield* store.publish({ commitId: commitId("pub-m") });
      assert.deepStrictEqual([...published].sort(), ["pub-a", "pub-b", "pub-m", "pub-root"]);

      const visible = yield* store.listCommits({
        historyId: historyId("pub"),
        visibility: "published",
      });
      assert.deepStrictEqual(ids(visible), ["pub-root", "pub-a", "pub-b", "pub-m"]);

      const again = yield* store.publish({ commitId: commitId("pub-m") });
      assert.deepStrictEqual(again, []);

      // Already-published ancestors are left alone.
      yield* append(store, "pub", "pub-next", ["pub-m"]);
      const onlyNew = yield* store.publish({ commitId: commitId("pub-next") });
      assert.deepStrictEqual([...onlyNew], ["pub-next"]);

      const missing = yield* store.publish({ commitId: commitId("pub-nowhere") }).pipe(Effect.flip);
      assert.strictEqual(missing._tag, "CommitNotFoundError");
    }),
  );

  it.effect("can be born published, and everything after it starts private", () =>
    Effect.gen(function* () {
      const store = yield* CommitStore.CommitStore;

      const importedRoot = yield* store.createHistory({
        historyId: historyId("imported"),
        rootCommit: newCommit("imported-root"),
        rootPublished: true,
      });
      assert.strictEqual(importedRoot.published, true);

      const child = yield* append(store, "imported", "imported-a", ["imported-root"]);
      assert.strictEqual(child.published, false);

      const blankRoot = yield* store.createHistory({
        historyId: historyId("blank"),
        rootCommit: newCommit("blank-root"),
        rootPublished: false,
      });
      assert.strictEqual(blankRoot.published, false);
      const blankVisible = yield* store.listCommits({
        historyId: historyId("blank"),
        visibility: "published",
      });
      assert.deepStrictEqual(blankVisible, []);
    }),
  );

  it.effect("hides drafts from published reads", () =>
    Effect.gen(function* () {
      const store = yield* CommitStore.CommitStore;

      yield* store.createHistory({
        historyId: historyId("vis"),
        rootCommit: newCommit("vis-root"),
        rootPublished: true,
      });
      yield* append(store, "vis", "vis-draft", ["vis-root"]);

      const publishedList = yield* store.listCommits({
        historyId: historyId("vis"),
        visibility: "published",
      });
      assert.deepStrictEqual(ids(publishedList), ["vis-root"]);

      const allList = yield* store.listCommits({
        historyId: historyId("vis"),
        visibility: "all",
      });
      assert.deepStrictEqual(ids(allList), ["vis-root", "vis-draft"]);

      const draftPublished = yield* store.getCommit({
        commitId: commitId("vis-draft"),
        visibility: "published",
      });
      assert.ok(Option.isNone(draftPublished));

      const draftAll = yield* store.getCommit({
        commitId: commitId("vis-draft"),
        visibility: "all",
      });
      assert.ok(Option.isSome(draftAll));

      const publishedChildren = yield* store.children({
        commitId: commitId("vis-root"),
        visibility: "published",
      });
      assert.deepStrictEqual(publishedChildren, []);
    }),
  );
});
