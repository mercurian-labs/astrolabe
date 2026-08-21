import { describe, expect, it } from "vite-plus/test";

import type { PlanTimelineItem } from "@t3tools/contracts";

import { codingSessionLeaf, commitId as id, message } from "../../test/fixtures/timeline";

import { buildPlanGraph } from "./PlanGraph.logic";
import {
  advance,
  isViewingPast,
  LATEST,
  positionAfterPick,
  resolveActingHead,
  resolveHead,
} from "./PlanPosition.logic";

const commit = (name: string, sequence: number, parents: ReadonlyArray<string>): PlanTimelineItem =>
  message(name, {
    sequence,
    parents,
    createdAt: "2026-08-03T00:00:00.000Z",
  });

/** a → b → c. */
const chain = buildPlanGraph([commit("a", 1, []), commit("b", 2, ["a"]), commit("c", 3, ["b"])]);

/**
 *      a
 *      |
 *      b
 *     / \
 *    l   r      (l is the first-born; r is the later sibling)
 *        |
 *       r2
 */
const fork = buildPlanGraph([
  commit("a", 1, []),
  commit("b", 2, ["a"]),
  commit("l", 3, ["b"]),
  commit("r", 4, ["b"]),
  commit("r2", 5, ["r"]),
]);

const empty = buildPlanGraph([]);

describe("resolveHead", () => {
  it("acts from the newest commit when nothing has been picked", () => {
    expect(resolveHead(chain, LATEST)).toBe(id("c"));
  });

  it("acts from the commit that was picked", () => {
    expect(resolveHead(fork, { _tag: "at", commitId: id("l"), live: true })).toBe(id("l"));
    expect(resolveHead(fork, { _tag: "at", commitId: id("b"), live: false })).toBe(id("b"));
  });

  it("has nothing to act from in a plan with no history yet", () => {
    expect(resolveHead(empty, LATEST)).toBeNull();
  });

  it("falls back to the newest commit when the picked one is not on the graph", () => {
    // The gap between switching plans and the first snapshot: the wrong branch
    // beats no answer.
    expect(resolveHead(chain, { _tag: "at", commitId: id("elsewhere"), live: true })).toBe(id("c"));
  });
});

describe("resolveActingHead", () => {
  it("keeps a viewed coding-session leaf visible but acts from its parent", () => {
    const session = codingSessionLeaf("session", {
      sequence: 4,
      parents: ["c"],
      createdAt: "2026-08-03T00:00:00.000Z",
      repositoryId: "repo",
      repositoryName: "server",
      planRevisionCommitId: "b",
    });
    const graph = buildPlanGraph([...chain.nodes.map(({ item }) => item), session]);
    expect(resolveHead(graph, positionAfterPick(graph, session.commitId))).toBe(id("session"));
    expect(resolveActingHead(graph, session.commitId)).toBe(id("c"));
    expect(resolveActingHead(graph, id("c"))).toBe(id("c"));
  });
});

describe("positionAfterPick", () => {
  it("stands you live in the conversation when you pick a branch tip", () => {
    expect(positionAfterPick(fork, id("l"))).toEqual({
      _tag: "at",
      commitId: id("l"),
      live: true,
    });
  });

  it("stands you live at the newest commit rather than following the plan's tip", () => {
    // Picking the newest commit is still picking a branch: a commit landing on
    // some other branch afterwards must not drag this window onto it.
    expect(positionAfterPick(fork, id("r2"))).toEqual({
      _tag: "at",
      commitId: id("r2"),
      live: true,
    });
  });

  it("has you looking back when you pick a commit that already led somewhere", () => {
    expect(positionAfterPick(fork, id("b"))).toEqual({
      _tag: "at",
      commitId: id("b"),
      live: false,
    });
  });

  it("lands on the default when the commit is not on the graph", () => {
    expect(positionAfterPick(chain, id("elsewhere"))).toEqual(LATEST);
  });
});

describe("advance", () => {
  it("follows a live head through everything that landed on its line", () => {
    expect(advance(chain, { _tag: "at", commitId: id("a"), live: true })).toEqual({
      _tag: "at",
      commitId: id("c"),
      live: true,
    });
  });

  it("rests once the head is a leaf again", () => {
    const atLeaf = { _tag: "at", commitId: id("c"), live: true } as const;
    expect(advance(chain, atLeaf)).toBe(atLeaf);
  });

  it("is idempotent, so a subscription echo racing a send settles the same way", () => {
    const once = advance(chain, { _tag: "at", commitId: id("a"), live: true });
    expect(advance(chain, once)).toEqual(once);
  });

  it("takes the first-born at a fork someone else opened", () => {
    // A window that sat passively while two siblings landed follows the one
    // that landed first; the window that sent the other set its own position.
    expect(advance(fork, { _tag: "at", commitId: id("b"), live: true })).toEqual({
      _tag: "at",
      commitId: id("l"),
      live: true,
    });
  });

  it("never moves a window that is looking back", () => {
    const lookingBack = { _tag: "at", commitId: id("b"), live: false } as const;
    expect(advance(fork, lookingBack)).toBe(lookingBack);
  });

  it("leaves the default alone — it already names the newest commit", () => {
    expect(advance(chain, LATEST)).toBe(LATEST);
  });
});

describe("isViewingPast", () => {
  it("is the one state that changes what sending promises", () => {
    expect(isViewingPast(fork, LATEST)).toBe(false);
    expect(isViewingPast(fork, { _tag: "at", commitId: id("l"), live: true })).toBe(false);
    expect(isViewingPast(fork, { _tag: "at", commitId: id("b"), live: false })).toBe(true);
  });

  it("is false for a commit the graph does not carry, matching the head fallback", () => {
    expect(isViewingPast(chain, { _tag: "at", commitId: id("elsewhere"), live: false })).toBe(
      false,
    );
  });
});
