/** A throwaway git repository for tests: write files, commit, get the sha. */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const GIT_CONFIG = [
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "init.defaultBranch=main",
];

/** A file's text, a symlink to a target, or null to delete it. */
export type FileChange = string | { readonly symlink: string } | null;

export interface TempRepo {
  readonly dir: string;
  /** Write (or delete) files and commit them; returns the commit sha. */
  commit(files: Readonly<Record<string, FileChange>>, message: string): string;
  /** Run git in the repository, for branches and checkouts. */
  git(...args: ReadonlyArray<string>): string;
  remove(): void;
}

export function tempRepo(): TempRepo {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "code-graph-"));
  const git = (...args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", [...GIT_CONFIG, "-C", dir, ...args], {
      encoding: "utf8",
    }).trim();
  git("init", "-q");
  return {
    dir,
    git,
    commit(files, message) {
      for (const [path, change] of Object.entries(files)) {
        const file = NodePath.join(dir, path);
        NodeFS.rmSync(file, { force: true });
        if (change === null) continue;
        NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
        if (typeof change === "string") NodeFS.writeFileSync(file, change);
        else NodeFS.symlinkSync(change.symlink, file);
      }
      git("add", "-A");
      git("commit", "-q", "--allow-empty", "-m", message);
      return git("rev-parse", "HEAD");
    },
    remove() {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Two commits over three files: one edited, one that only gains a resolution, one untouched. */
export const TWO_COMMITS = {
  first: {
    "src/a.ts": `export function keep() {
  return 1;
}
export function change() {
  return 1;
}
export function drop() {}
`,
    // `later` is used before anything writes it: a frontier until a.ts defines it.
    "src/b.ts": `import { change } from "./a.ts";
export function user() {
  change();
  later();
}
`,
    "src/c.ts": `export function other() {
  return 0;
}
`,
    "README.md": "not code\n",
  },
  second: {
    "src/a.ts": `export function keep() {
  return 1;
}
export function change() {
  return 2;
}
export function later() {
  keep();
}
`,
  },
} as const;
