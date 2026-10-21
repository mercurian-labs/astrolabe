// @vitest-environment node
// @effect-diagnostics nodeBuiltinImport:off - A test of a dev-server plugin: it builds a git repository on disk.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { allowedPath, readCodeFile, readStorySources, type CodeStorySource } from "./codeFiles.ts";

const GIT = [
  "-c",
  "user.name=Test",
  "-c",
  "user.email=t@example.com",
  "-c",
  "commit.gpgsign=false",
];

/** A throwaway repository: `commit` writes files (null deletes) and returns the sha. */
function tempRepo() {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "code-files-"));
  const git = (...args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", [...GIT, "-C", dir, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  return {
    dir,
    commit(files: Readonly<Record<string, string | null>>) {
      for (const [path, text] of Object.entries(files)) {
        const file = NodePath.join(dir, path);
        if (text === null) NodeFS.rmSync(file);
        else {
          NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
          NodeFS.writeFileSync(file, text);
        }
      }
      git("add", "-A");
      git("commit", "-q", "-m", "commit");
      return git("rev-parse", "HEAD");
    },
  };
}

describe("the code files endpoint", () => {
  const repo = tempRepo();
  const first = repo.commit({ "src/a.ts": "one\n", "secret.txt": "keep out\n" });
  const second = repo.commit({ "src/a.ts": "two\n", "src/b.ts": "new\n" });
  const story: CodeStorySource = { id: "demo", repo: repo.dir, paths: ["src"] };
  afterAll(() => NodeFS.rmSync(repo.dir, { recursive: true, force: true }));

  it("serves a file at a commit and at its first parent", async () => {
    expect(await readCodeFile(story, second, "src/a.ts", false)).toEqual({
      status: 200,
      body: "two\n",
    });
    expect(await readCodeFile(story, second, "src/a.ts", true)).toEqual({
      status: 200,
      body: "one\n",
    });
  });

  it("reads a file the commit created as empty before it, and a root commit's parent as nothing", async () => {
    expect(await readCodeFile(story, second, "src/b.ts", true)).toEqual({
      status: 200,
      body: "",
      missing: true,
    });
    expect(await readCodeFile(story, first, "src/a.ts", true)).toEqual({
      status: 200,
      body: "",
      missing: true,
    });
    expect((await readCodeFile(story, first, "src/b.ts", false)).status).toBe(404);
  });

  it("refuses paths outside the story, escapes, and refs that are not shas", async () => {
    expect((await readCodeFile(story, second, "secret.txt", false)).status).toBe(403);
    expect((await readCodeFile(story, second, "src/../secret.txt", false)).status).toBe(403);
    expect((await readCodeFile(story, second, "/etc/passwd", false)).status).toBe(403);
    expect((await readCodeFile(story, "HEAD", "src/a.ts", false)).status).toBe(400);
    expect((await readCodeFile(story, "--output=x", "src/a.ts", false)).status).toBe(400);
    expect(allowedPath("srcfoo/a.ts", ["src"])).toBe(false);
    expect(allowedPath("src/a.ts", ["src/"])).toBe(true);
  });

  it("says so when the story's repository is not on this machine", async () => {
    const gone = { ...story, repo: NodePath.join(repo.dir, "nowhere") };
    const response = await readCodeFile(gone, second, "src/a.ts", false);
    expect(response.status).toBe(404);
    expect(response.body).toContain("not here");
  });

  it("registers stories from fixtures that name their source", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "code-stories-"));
    try {
      const write = (name: string, value: unknown) =>
        NodeFS.writeFileSync(NodePath.join(dir, name), JSON.stringify(value));
      write("a.story.json", { source: { repo: repo.dir, paths: ["src"] }, memory: { id: "a" } });
      write("b.story.json", { memory: { id: "b" } });
      expect(readStorySources(dir)).toEqual([{ id: "a", repo: repo.dir, paths: ["src"] }]);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
