// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off - A dev-server plugin: it reads code stories' files from their git repositories.
/**
 * The code stories' files, read from git at each turn's commit, for the
 * playground's code view (see `codeEdits.tsx`). Each story fixture says where it
 * was read from (`source: { repo, paths }`); the plugin registers those at
 * start and serves only files under a story's paths.
 *
 *   GET /__code/file?story=<memory id>&ref=<sha>&path=<path>
 *       the file's text at the commit; 404 when the repository or the file is missing
 *   GET /__code/file?...&parent=1
 *       the file's text at the commit's first parent; empty (with `x-code-missing: 1`)
 *       when the file did not exist there
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { Plugin } from "vite-plus";

export interface CodeStorySource {
  /** The story's memory id. */
  readonly id: string;
  readonly repo: string;
  readonly paths: ReadonlyArray<string>;
}

export interface CodeFileResponse {
  readonly status: number;
  readonly body: string;
  /** The file did not exist at the parent commit. */
  readonly missing?: true;
}

/** Larger files are refused rather than shipped to a popup. */
export const MAX_FILE_BYTES = 1024 * 1024;

const REF = /^[0-9a-f]{7,40}$/;

/** The stories under `dir` that say where they were read from. */
export function readStorySources(dir: string): ReadonlyArray<CodeStorySource> {
  if (!NodeFS.existsSync(dir)) return [];
  return NodeFS.readdirSync(dir)
    .filter((name) => name.endsWith(".story.json"))
    .toSorted()
    .flatMap((name) => {
      const story = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, name), "utf8")) as {
        source?: { repo?: unknown; paths?: unknown };
        memory?: { id?: unknown };
      };
      const { repo, paths } = story.source ?? {};
      const id = story.memory?.id;
      if (typeof id !== "string" || typeof repo !== "string" || !Array.isArray(paths)) return [];
      return [
        { id, repo, paths: paths.filter((path): path is string => typeof path === "string") },
      ];
    });
}

/** A repository-relative path inside one of `paths` (all of the tree when there are none). */
export function allowedPath(path: string, paths: ReadonlyArray<string>): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    return false;
  }
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  if (paths.length === 0) return true;
  return paths.some((root) => {
    const prefix = root.replace(/\/+$/, "");
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

function git(repo: string, args: ReadonlyArray<string>) {
  return new Promise<{ ok: boolean; stdout: string }>((resolve) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", repo, ...args],
      { encoding: "utf8", maxBuffer: MAX_FILE_BYTES + 1024 },
      (error, stdout) => resolve({ ok: error === null, stdout }),
    );
  });
}

/** One file's text at `ref`, or at its first parent. */
export async function readCodeFile(
  story: CodeStorySource,
  ref: string,
  path: string,
  parent: boolean,
): Promise<CodeFileResponse> {
  if (!REF.test(ref)) return { status: 400, body: "ref must be a commit sha" };
  if (!allowedPath(path, story.paths)) {
    return { status: 403, body: `${path} is outside the story's paths` };
  }
  if (!NodeFS.existsSync(story.repo)) {
    return { status: 404, body: `the story's repository is not here: ${story.repo}` };
  }
  const object = `${ref}${parent ? "^" : ""}:${path}`;
  const size = await git(story.repo, ["cat-file", "-s", object]);
  if (!size.ok) {
    if (!parent) return { status: 404, body: `${path} is not in ${ref.slice(0, 12)}` };
    // A file the commit created, or a commit with no parent: nothing before it.
    return { status: 200, body: "", missing: true };
  }
  if (Number(size.stdout.trim()) > MAX_FILE_BYTES) {
    return { status: 413, body: `${path} is larger than ${MAX_FILE_BYTES} bytes` };
  }
  const shown = await git(story.repo, ["show", object]);
  return shown.ok
    ? { status: 200, body: shown.stdout }
    : { status: 404, body: `${path} could not be read at ${ref.slice(0, 12)}` };
}

export function codeFiles(options: { fixturesDir: string }): Plugin {
  return {
    name: "atlas-code-files",
    apply: "serve",
    configureServer(server) {
      const stories = new Map(
        readStorySources(options.fixturesDir).map((story) => [story.id, story]),
      );
      for (const story of stories.values()) {
        if (!NodeFS.existsSync(story.repo)) {
          console.warn(
            `[code] ${story.id}: no repository at ${story.repo}; its code view will say so`,
          );
        }
      }
      server.middlewares.use("/__code/file", (req, res) => {
        const query = new URL(req.url ?? "", "http://playground").searchParams;
        const story = stories.get(query.get("story") ?? "");
        const reply = (response: CodeFileResponse) => {
          res.statusCode = response.status;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          if (response.missing === true) res.setHeader("x-code-missing", "1");
          res.end(response.body);
        };
        if (story === undefined) {
          reply({ status: 404, body: `no code story ${query.get("story") ?? ""}` });
          return;
        }
        void readCodeFile(
          story,
          query.get("ref") ?? "",
          query.get("path") ?? "",
          query.get("parent") === "1",
        ).then(reply);
      });
      console.info(`[code] ${stories.size} code stories: ${[...stories.keys()].join(", ")}`);
    },
  };
}
