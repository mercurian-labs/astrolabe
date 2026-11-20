import {
  MessageId,
  RunId,
  ThreadId,
  type GitClientFile,
  type GitClientTurn,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentAsks,
  appendAsk,
  changeRows,
  commitScope,
  commitScopeLabel,
  gitKeyAction,
  groupChanges,
  keepSelection,
  moveSelection,
  stageToggle,
} from "./gitClientLogic";

const turn = (n: number): GitClientTurn => ({
  runId: RunId.make(`run:${n}`),
  threadId: ThreadId.make("thread:1"),
  threadTitle: "Fix the build",
  turnNumber: n,
  request: "make it pass",
  userMessageId: MessageId.make(`message:${n}`),
  startedAt: null,
  completedAt: null,
});

const file = (path: string, overrides: Partial<GitClientFile> = {}): GitClientFile => ({
  path,
  originalPath: null,
  index: null,
  workingTree: "modified",
  untracked: false,
  conflicted: false,
  additions: 1,
  deletions: 0,
  turnRunId: null,
  earlierTurns: 0,
  ...overrides,
});

const none = { ctrl: false, meta: false, alt: false };

describe("Git tab changes", () => {
  it("put conflicts first, then turns newest first, then the person's own", () => {
    const groups = groupChanges({
      // The server sends turns newest first.
      turns: [turn(4), turn(2)],
      files: [
        file("z.ts"),
        file("b.ts", { turnRunId: RunId.make("run:2") }),
        file("a.ts", { turnRunId: RunId.make("run:4") }),
        file("c.ts", { turnRunId: RunId.make("run:4"), conflicted: true }),
        // A turn the status no longer describes leaves its file with the person's.
        file("y.ts", { turnRunId: RunId.make("run:9") }),
      ],
    });
    expect(groups.map((group) => [group.key, group.files.map((f) => f.path)])).toEqual([
      ["group:conflicts", ["c.ts"]],
      ["group:run:4", ["a.ts"]],
      ["group:run:2", ["b.ts"]],
      ["group:own", ["y.ts", "z.ts"]],
    ]);
    expect(changeRows(groups).map((row) => row.key)).toEqual([
      "group:conflicts",
      "file:c.ts",
      "group:run:4",
      "file:a.ts",
      "group:run:2",
      "file:b.ts",
      "group:own",
      "file:y.ts",
      "file:z.ts",
    ]);
  });

  it("stage a group unless all of it is staged, and unstage a rename with its source", () => {
    expect(stageToggle([file("a.ts", { index: "modified" }), file("b.ts")])).toEqual({
      action: "stage",
      paths: ["a.ts", "b.ts"],
    });
    expect(
      stageToggle([
        file("new.ts", { index: "renamed", workingTree: null, originalPath: "old.ts" }),
        file("a.ts", { index: "modified", workingTree: null }),
      ]),
    ).toEqual({ action: "unstage", paths: ["new.ts", "old.ts", "a.ts"] });
    expect(stageToggle([])).toBeNull();
  });

  it("say what a commit would take", () => {
    expect(commitScopeLabel(commitScope([file("a.ts", { index: "modified" }), file("b.ts")]))).toBe(
      "1 staged file",
    );
    expect(commitScopeLabel(commitScope([file("a.ts"), file("b.ts"), file("c.ts")]))).toBe(
      "all 3 changed files",
    );
    expect(commitScope([])).toEqual({ mode: "none" });
  });
});

describe("Git tab selection", () => {
  const keys = ["group:own", "file:a.ts", "file:b.ts"];

  it("keeps a row across a refresh, or takes the row now in its place", () => {
    expect(keepSelection(keys, "file:b.ts", 0)).toBe("file:b.ts");
    expect(keepSelection(keys, "file:gone.ts", 1)).toBe("file:a.ts");
    expect(keepSelection(keys, "file:gone.ts", 7)).toBe("file:b.ts");
    expect(keepSelection([], "file:a.ts", 0)).toBeNull();
  });

  it("moves within the list and stops at its ends", () => {
    expect(moveSelection(keys, "file:a.ts", 1)).toBe("file:b.ts");
    expect(moveSelection(keys, "file:b.ts", 1)).toBe("file:b.ts");
    expect(moveSelection(keys, "group:own", -1)).toBe("group:own");
    expect(moveSelection(keys, null, 1)).toBe("group:own");
  });
});

describe("Git tab keys", () => {
  it("stage, discard and undo only in Changes", () => {
    expect(gitKeyAction(" ", none, "changes")).toEqual({ type: "toggleStage" });
    expect(gitKeyAction("d", none, "changes")).toEqual({ type: "discard" });
    expect(gitKeyAction(" ", none, "commits")).toBeNull();
    expect(gitKeyAction("z", none, "commits")).toBeNull();
    expect(gitKeyAction("Enter", none, "changes")).toEqual({ type: "open" });
    expect(gitKeyAction("Enter", none, "commits")).toBeNull();
  });

  it("leave chords to the app", () => {
    expect(gitKeyAction("p", { ...none, meta: true }, "changes")).toBeNull();
    expect(gitKeyAction("j", { ...none, ctrl: true }, "changes")).toBeNull();
    expect(gitKeyAction("P", none, "changes")).toEqual({ type: "push" });
  });
});

describe("Git tab asks for the agent", () => {
  it("offer resolving for conflicts and rebasing when behind", () => {
    const asks = agentAsks(
      { kind: "files", paths: ["src/a b.ts"], conflicted: true },
      "origin/main",
    );
    expect(asks.map((ask) => ask.id)).toEqual(["resolve", "commit", "explain", "finish", "rebase"]);
    expect(asks[1]?.prompt).toBe("Commit [a b.ts](src/a%20b.ts) with a good message.");
    expect(asks.at(-1)?.label).toBe("Rebase onto origin/main and fix what breaks");
  });

  it("name a commit by short sha and subject", () => {
    const asks = agentAsks(
      { kind: "commit", commit: { sha: "0123456789abcdef", subject: "Fix the build" } },
      null,
    );
    expect(asks.map((ask) => ask.prompt)).toEqual([
      "Explain commit 0123456 “Fix the build”.",
      "Split commit 0123456 “Fix the build” into smaller commits that each make sense on their own.",
      "Reword the message of commit 0123456 “Fix the build” so it says what changed and why.",
    ]);
  });

  it("add to a draft, never replace it", () => {
    expect(appendAsk("", "Explain this.")).toBe("Explain this.");
    expect(appendAsk("Look at the tests.  \n", "Explain this.")).toBe(
      "Look at the tests.\n\nExplain this.",
    );
  });
});
