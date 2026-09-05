import * as Effect from "effect/Effect";

import type { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";

export interface RepositoryDefault {
  readonly branch: string;
  readonly ref: string;
  readonly oid: string;
}

/** Resolve the branch and commit new line work starts from in this repository. */
export const resolveRepositoryDefault = Effect.fn("resolveRepositoryDefault")(function* (input: {
  readonly git: GitVcsDriver["Service"];
  readonly path: string;
  readonly startFromOrigin: boolean;
}) {
  const remoteHead = input.startFromOrigin
    ? yield* input.git.execute({
        operation: "LineBranchReactor.defaultRemote",
        cwd: input.path,
        args: ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        allowNonZeroExit: true,
      })
    : undefined;
  const localHead =
    remoteHead?.exitCode === 0
      ? undefined
      : yield* input.git.execute({
          operation: "LineBranchReactor.defaultLocal",
          cwd: input.path,
          args: ["symbolic-ref", "--quiet", "HEAD"],
          allowNonZeroExit: true,
        });
  const symbolic =
    remoteHead?.exitCode === 0
      ? remoteHead.stdout.trim()
      : localHead?.exitCode === 0
        ? localHead.stdout.trim()
        : "HEAD";
  const resolved = yield* input.git.execute({
    operation: "LineBranchReactor.resolveBase",
    cwd: input.path,
    args: ["rev-parse", "--verify", `${symbolic}^{commit}`],
  });
  const branch = symbolic.startsWith("refs/remotes/origin/")
    ? symbolic.slice("refs/remotes/origin/".length)
    : symbolic.replace(/^refs\/heads\//u, "");
  return { branch, ref: symbolic, oid: resolved.stdout.trim() } satisfies RepositoryDefault;
});
