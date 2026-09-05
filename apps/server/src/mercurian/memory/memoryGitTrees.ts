import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";

/** Object-only operations; never borrow a slot or alter a checkout's index. */
export const makeMemoryGitTrees = Effect.gen(function* () {
  const git = yield* GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const run = (cwd: string, args: readonly string[]) =>
    git.execute({ operation: "MemoryCuration.tree", cwd, args });
  const commit = Effect.fn("MemoryCuration.commit")(function* (
    cwd: string,
    tree: string,
    parents: readonly string[],
    message: string,
  ) {
    return (yield* run(cwd, [
      "commit-tree",
      tree,
      ...parents.flatMap((p) => ["-p", p]),
      "-m",
      message,
    ])).stdout.trim();
  });
  const overlay = Effect.fn("MemoryCuration.overlay")(function* (
    cwd: string,
    base: string,
    from: string,
    paths: readonly string[],
  ) {
    if (!paths.length) return (yield* run(cwd, ["rev-parse", `${base}^{tree}`])).stdout.trim();
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "memory-curation-" });
        const env = { ...process.env, GIT_INDEX_FILE: path.join(directory, "index") };
        const indexed = (args: readonly string[], stdin?: string) =>
          git.execute({
            operation: "MemoryCuration.overlay",
            cwd,
            args,
            env,
            ...(stdin === undefined ? {} : { stdin }),
          });
        yield* indexed(["read-tree", base]);
        yield* indexed(["update-index", "--force-remove", "--", ...paths]);
        const entries = yield* run(cwd, ["ls-tree", "-r", "-z", from, "--", ...paths]);
        if (entries.stdout) yield* indexed(["update-index", "-z", "--index-info"], entries.stdout);
        return (yield* indexed(["write-tree"])).stdout.trim();
      }),
    );
  });
  // Git 2.38 supports merge-tree --write-tree. Synthetic siblings force an exact
  // base without --merge-base (added later), including inverse and rewritten history.
  const merge = Effect.fn("MemoryCuration.merge")(function* (
    cwd: string,
    base: string,
    leftTree: string,
    rightTree: string,
  ) {
    const left = yield* commit(cwd, leftTree, [base], "t3 curation comparison left");
    const right = yield* commit(cwd, rightTree, [base], "t3 curation comparison right");
    const result = yield* git.execute({
      operation: "MemoryCuration.merge",
      cwd,
      args: ["merge-tree", "--write-tree", "--name-only", "-z", left, right],
      allowNonZeroExit: true,
    });
    const fields = result.stdout.split("\0");
    if (result.exitCode === 1) {
      const end = fields.indexOf("", 1);
      return {
        kind: "conflict",
        paths: fields.slice(1, end < 0 ? undefined : end).sort(),
      } as const;
    }
    if (result.exitCode !== 0)
      return yield* git
        .execute({
          operation: "MemoryCuration.merge",
          cwd,
          args: ["merge-tree", "--write-tree", left, right],
        })
        .pipe(Effect.flatMap(() => Effect.die("Unexpected merge-tree result")));
    return { kind: "merged", treeOid: fields[0]!.trim() } as const;
  });
  // Copy the real index before reading it: even write-tree may update its cache.
  const checkoutTrees = Effect.fn("MemoryCuration.checkoutTrees")(function* (cwd: string) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "memory-checkout-" });
        const indexPath = (yield* run(cwd, [
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "index",
        ])).stdout.trim();
        const temporaryIndex = path.join(directory, "index");
        yield* fs.copyFile(indexPath, temporaryIndex);
        const indexed = (args: readonly string[]) =>
          git.execute({
            operation: "MemoryCuration.checkoutTrees",
            cwd,
            args,
            env: { ...process.env, GIT_INDEX_FILE: temporaryIndex },
          });
        const indexOid = (yield* indexed(["write-tree"])).stdout.trim();
        yield* indexed(["add", "-A", "--", "."]);
        const worktreeOid = (yield* indexed(["write-tree"])).stdout.trim();
        return { indexOid, worktreeOid };
      }),
    );
  });
  return { run, commit, overlay, merge, checkoutTrees };
});
