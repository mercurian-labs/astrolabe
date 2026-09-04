/**
 * Snapshot parent rule: `^2` is the HEAD at capture when present; `^1` is the
 * previous snapshot when `^2` exists, otherwise `^1` is the HEAD (git cannot
 * omit parent 1). Walk the chain with --first-parent only through two-parent
 * commits.
 */
import * as NodeCrypto from "node:crypto";

import {
  CheckpointRef,
  type BranchMovement,
  type MercurianCommitId,
  type MercurianRepositoryId,
  type SnapshotKind,
  type VcsError,
  type GitCommandError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { LineBranchStore } from "../commitTree/LineBranchStore.ts";
import type { LineBranchStoreError } from "../commitTree/LineBranchStore.ts";
import { SlotStore } from "./SlotStore.ts";
import type { SlotStoreError } from "./SlotStore.ts";

const LINE_REFS_PREFIX = "refs/t3/lines";

export class SnapshotChainError extends Schema.TaggedErrorClass<SnapshotChainError>()(
  "SnapshotChainError",
  { operation: Schema.String, cause: Schema.Unknown },
) {}

export function lineSnapshotRef(lineRootCommitId: MercurianCommitId): CheckpointRef {
  return CheckpointRef.make(
    `${LINE_REFS_PREFIX}/${Encoding.encodeBase64Url(lineRootCommitId)}/snapshot`,
  );
}

export function lineExtraSnapshotRef(
  lineRootCommitId: MercurianCommitId,
  kind: "recovery" | "external" | "curated",
  timestamp: DateTime.Utc,
): CheckpointRef {
  const compact = DateTime.formatIso(timestamp).replaceAll(/[-:.]/gu, "");
  return CheckpointRef.make(
    `${LINE_REFS_PREFIX}/${Encoding.encodeBase64Url(lineRootCommitId)}/snapshots/${kind}-${compact}`,
  );
}

interface CaptureInput {
  readonly cwd: string;
  readonly lineRootCommitId: MercurianCommitId;
  readonly repositoryId: MercurianRepositoryId;
  readonly lineBranch: string;
  readonly kind: SnapshotKind;
  readonly ref: CheckpointRef;
}

interface CaptureTreeInput {
  readonly cwd: string;
  readonly lineRootCommitId: MercurianCommitId;
  readonly repositoryId: MercurianRepositoryId;
  readonly lineBranch: string;
  readonly kind: "curated";
  readonly treeOid: string;
}

interface StandingInput {
  readonly cwd: string;
  readonly lineRootCommitId: MercurianCommitId;
  readonly repositoryId: MercurianRepositoryId;
  readonly lineBranch: string;
}

export type LineStanding =
  | { readonly _tag: "on-line" }
  | { readonly _tag: "renamed"; readonly branch: string }
  | { readonly _tag: "departed"; readonly ref: string; readonly recordedMissing: boolean };

interface BranchMovementInput {
  readonly cwd: string;
  readonly previousOid: string | null;
  readonly lineRootCommitId: MercurianCommitId;
  readonly repositoryId: MercurianRepositoryId;
  readonly lineBranch: string;
}

interface DriftInput {
  readonly cwd: string;
  readonly lineRootCommitId: MercurianCommitId;
  readonly lineBranch: string;
}

export class SnapshotChain extends Context.Service<
  SnapshotChain,
  {
    readonly capture: (input: CaptureInput) => Effect.Effect<
      {
        readonly oid: string;
        readonly previousOid: string | null;
        readonly headOid: string | null;
        readonly headRef: string | null;
        readonly built: boolean;
      },
      VcsError | GitCommandError | LineBranchStoreError | SnapshotChainError
    >;
    readonly captureTree: (input: CaptureTreeInput) => Effect.Effect<
      {
        readonly oid: string;
        readonly previousOid: string | null;
        readonly headOid: string;
        readonly headRef: string;
        readonly built: boolean;
      },
      GitCommandError | LineBranchStoreError | SnapshotChainError
    >;
    readonly branchMovement: (
      input: BranchMovementInput,
    ) => Effect.Effect<BranchMovement, GitCommandError | LineBranchStoreError | SnapshotChainError>;
    readonly readStanding: (
      input: StandingInput,
    ) => Effect.Effect<LineStanding, GitCommandError | LineBranchStoreError | SnapshotChainError>;
    readonly lineCommit: (
      input: StandingInput,
    ) => Effect.Effect<string, GitCommandError | LineBranchStoreError | SnapshotChainError>;
    readonly adoptRename: (input: {
      readonly lineRootCommitId: MercurianCommitId;
      readonly repositoryId: MercurianRepositoryId;
      readonly branch: string;
    }) => Effect.Effect<void, LineBranchStoreError | SlotStoreError>;
    readonly isDrifted: (input: DriftInput) => Effect.Effect<boolean, GitCommandError>;
  }
>()("t3/mercurian/worktreeSlots/SnapshotChain") {}

export const make = Effect.gen(function* () {
  const checkpoints = yield* CheckpointStore;
  const git = yield* GitVcsDriver;
  const lineBranches = yield* LineBranchStore;
  const slots = yield* SlotStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const resolve = Effect.fn("SnapshotChain.resolve")(function* (cwd: string, ref: string) {
    const result = yield* git.execute({
      operation: "SnapshotChain.resolve",
      cwd,
      args: ["rev-parse", "--verify", "--quiet", ref],
      allowNonZeroExit: true,
    });
    if (result.exitCode !== 0) return null;
    const oid = result.stdout.trim();
    return oid.length === 0 ? null : oid;
  });

  const capture = Effect.fn("SnapshotChain.capture")(function* (input: CaptureInput) {
    const snapshotRef = lineSnapshotRef(input.lineRootCommitId);
    const previousOid = yield* resolve(input.cwd, `${snapshotRef}^{commit}`);
    const headOid = yield* resolve(input.cwd, "HEAD^{commit}");
    const symbolicHead = yield* git.execute({
      operation: "SnapshotChain.capture.headRef",
      cwd: input.cwd,
      args: ["symbolic-ref", "-q", "HEAD"],
      allowNonZeroExit: true,
    });
    const headRef = symbolicHead.exitCode === 0 ? symbolicHead.stdout.trim() || null : null;
    const parents = [previousOid, headOid].filter((oid): oid is string => oid !== null);
    yield* checkpoints.captureCheckpoint({
      cwd: input.cwd,
      checkpointRef: input.ref,
      parents,
      message: `t3 snapshot kind=${input.kind} ref=${input.ref}`,
    });
    const oid = yield* resolve(input.cwd, `${input.ref}^{commit}`);
    if (oid === null) {
      return yield* new SnapshotChainError({
        operation: "capture",
        cause: new Error(`Snapshot ref ${input.ref} did not resolve after capture`),
      });
    }
    yield* git.execute({
      operation: "SnapshotChain.capture.moveLineRef",
      cwd: input.cwd,
      args: ["update-ref", snapshotRef, oid],
    });
    const line = yield* lineBranches.get({
      lineRootCommitId: input.lineRootCommitId,
      repositoryId: input.repositoryId,
    });
    if (Option.isNone(line)) {
      return yield* new SnapshotChainError({
        operation: "capture:lineBranch",
        cause: new Error(`Line branch ${input.lineRootCommitId} is missing`),
      });
    }
    const [snapshotTree, baseTree, branchTip] = yield* Effect.all([
      resolve(input.cwd, `${oid}^{tree}`),
      resolve(input.cwd, `${line.value.baseOid}^{tree}`),
      resolve(input.cwd, `refs/heads/${input.lineBranch}^{commit}`),
    ]);
    const changed = snapshotTree !== baseTree || branchTip !== line.value.baseOid;
    if (changed && !line.value.built) {
      yield* lineBranches.markBuilt({
        lineRootCommitId: input.lineRootCommitId,
        repositoryId: input.repositoryId,
      });
    }
    return { oid, previousOid, headOid, headRef, built: line.value.built || changed };
  });

  const captureTree = Effect.fn("SnapshotChain.captureTree")(function* (input: CaptureTreeInput) {
    const snapshotRef = lineSnapshotRef(input.lineRootCommitId);
    const previousOid = yield* resolve(input.cwd, `${snapshotRef}^{commit}`);
    const headRef = `refs/heads/${input.lineBranch}`;
    const headOid = yield* resolve(input.cwd, `${headRef}^{commit}`);
    if (headOid === null) {
      return yield* new SnapshotChainError({
        operation: "captureTree:lineBranch",
        cause: new Error(`Line branch ${input.lineBranch} is missing`),
      });
    }
    const now = yield* DateTime.now;
    const ref = lineExtraSnapshotRef(input.lineRootCommitId, input.kind, now);
    const parents = [previousOid, headOid].filter((oid): oid is string => oid !== null);
    const commit = yield* git.execute({
      operation: "SnapshotChain.captureTree.commit",
      cwd: input.cwd,
      args: [
        "commit-tree",
        input.treeOid,
        ...parents.flatMap((parent) => ["-p", parent]),
        "-m",
        `t3 snapshot kind=${input.kind} ref=${ref}`,
      ],
    });
    const oid = commit.stdout.trim();
    yield* git.execute({
      operation: "SnapshotChain.captureTree.record",
      cwd: input.cwd,
      args: ["update-ref", ref, oid],
    });
    yield* git.execute({
      operation: "SnapshotChain.captureTree.moveLineRef",
      cwd: input.cwd,
      args: ["update-ref", snapshotRef, oid],
    });
    const line = yield* lineBranches.get({
      lineRootCommitId: input.lineRootCommitId,
      repositoryId: input.repositoryId,
    });
    if (Option.isNone(line)) {
      return yield* new SnapshotChainError({
        operation: "captureTree:lineBranch",
        cause: new Error(`Line branch ${input.lineRootCommitId} is missing`),
      });
    }
    const baseTree = yield* resolve(input.cwd, `${line.value.baseOid}^{tree}`);
    const changed = input.treeOid !== baseTree || headOid !== line.value.baseOid;
    if (changed && !line.value.built) {
      yield* lineBranches.markBuilt({
        lineRootCommitId: input.lineRootCommitId,
        repositoryId: input.repositoryId,
      });
    }
    return { oid, previousOid, headOid, headRef, built: line.value.built || changed };
  });

  const lineCommit = Effect.fn("SnapshotChain.lineCommit")(function* (input: StandingInput) {
    const recorded = yield* resolve(input.cwd, `refs/heads/${input.lineBranch}^{commit}`);
    if (recorded !== null) return recorded;
    const snapshotRef = lineSnapshotRef(input.lineRootCommitId);
    const recordedHead =
      (yield* resolve(input.cwd, `${snapshotRef}^2`)) ??
      (yield* resolve(input.cwd, `${snapshotRef}^1`));
    if (recordedHead !== null) return recordedHead;
    const line = yield* lineBranches.get({
      lineRootCommitId: input.lineRootCommitId,
      repositoryId: input.repositoryId,
    });
    if (Option.isNone(line)) {
      return yield* new SnapshotChainError({
        operation: "lineCommit",
        cause: new Error(`Line branch ${input.lineRootCommitId} is missing`),
      });
    }
    return line.value.baseOid;
  });

  const readStanding = Effect.fn("SnapshotChain.readStanding")(function* (input: StandingInput) {
    const symbolicHead = yield* git.execute({
      operation: "SnapshotChain.readStanding.headRef",
      cwd: input.cwd,
      args: ["symbolic-ref", "-q", "HEAD"],
      allowNonZeroExit: true,
    });
    const headRef = symbolicHead.exitCode === 0 ? symbolicHead.stdout.trim() || null : null;
    if (headRef === `refs/heads/${input.lineBranch}`) return { _tag: "on-line" } as const;
    const [headOid, recordedOid, commitOid] = yield* Effect.all([
      resolve(input.cwd, "HEAD^{commit}"),
      resolve(input.cwd, `refs/heads/${input.lineBranch}^{commit}`),
      lineCommit(input),
    ]);
    if (recordedOid === null && headRef !== null && headOid !== null && headOid === commitOid) {
      return { _tag: "renamed", branch: headRef.replace(/^refs\/heads\//u, "") } as const;
    }
    return {
      _tag: "departed",
      ref: headRef ?? "detached",
      recordedMissing: recordedOid === null,
    } as const;
  });

  const adoptRename = Effect.fn("SnapshotChain.adoptRename")(function* (input: {
    readonly lineRootCommitId: MercurianCommitId;
    readonly repositoryId: MercurianRepositoryId;
    readonly branch: string;
  }) {
    yield* lineBranches.rename(input);
    const allSlots = yield* slots.listAll;
    yield* Effect.forEach(
      allSlots.filter(
        (slot) =>
          slot.currentLineRootCommitId === input.lineRootCommitId &&
          slot.members.some((member) => member.repositoryId === input.repositoryId),
      ),
      (slot) =>
        slots.updateMemberBranch({
          slotId: slot.slotId,
          repositoryId: input.repositoryId,
          currentBranch: input.branch,
        }),
      { discard: true },
    );
  });

  const workingTreeOid = Effect.fn("SnapshotChain.workingTreeOid")(function* (cwd: string) {
    const commonDirResult = yield* git.execute({
      operation: "SnapshotChain.workingTreeOid.commonDir",
      cwd,
      args: ["rev-parse", "--git-common-dir"],
    });
    const commonDir = commonDirResult.stdout.trim();
    const resolvedCommonDir = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
    const tempIndexPath = path.join(
      resolvedCommonDir,
      `t3-snapshot-index-${NodeCrypto.randomUUID()}`,
    );
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: tempIndexPath };
    const cleanup = fileSystem.remove(tempIndexPath, { force: true }).pipe(Effect.ignore);

    return yield* Effect.gen(function* () {
      if ((yield* resolve(cwd, "HEAD^{commit}")) !== null) {
        yield* git.execute({
          operation: "SnapshotChain.workingTreeOid.readHead",
          cwd,
          args: ["read-tree", "HEAD"],
          env,
        });
      }
      yield* git.execute({
        operation: "SnapshotChain.workingTreeOid.add",
        cwd,
        args: ["add", "-A", "--", "."],
        env,
      });
      const tree = yield* git.execute({
        operation: "SnapshotChain.workingTreeOid.writeTree",
        cwd,
        args: ["write-tree"],
        env,
      });
      return tree.stdout.trim();
    }).pipe(Effect.ensuring(cleanup));
  });

  const branchMovement = Effect.fn("SnapshotChain.branchMovement")(function* (
    input: BranchMovementInput,
  ) {
    let previousHead: string | null;
    if (input.previousOid === null) {
      const line = yield* lineBranches.get({
        lineRootCommitId: input.lineRootCommitId,
        repositoryId: input.repositoryId,
      });
      if (Option.isNone(line)) {
        return yield* new SnapshotChainError({
          operation: "branchMovement",
          cause: new Error(`Line branch ${input.lineRootCommitId} is missing`),
        });
      }
      previousHead = line.value.baseOid;
    } else {
      previousHead =
        (yield* resolve(input.cwd, `${input.previousOid}^2`)) ??
        (yield* resolve(input.cwd, `${input.previousOid}^1`));
    }
    const tip = yield* resolve(input.cwd, `refs/heads/${input.lineBranch}^{commit}`);
    if (previousHead === null || tip === null || previousHead === tip) {
      return { kind: "unchanged" } as const;
    }
    const ancestor = yield* git.execute({
      operation: "SnapshotChain.branchMovement.isAncestor",
      cwd: input.cwd,
      args: ["merge-base", "--is-ancestor", previousHead, tip],
      allowNonZeroExit: true,
    });
    if (ancestor.exitCode !== 0) return { kind: "rewritten" } as const;
    const count = yield* git.execute({
      operation: "SnapshotChain.branchMovement.count",
      cwd: input.cwd,
      args: ["rev-list", "--count", `${previousHead}..${tip}`],
    });
    return { kind: "added", count: Number.parseInt(count.stdout.trim(), 10) } as const;
  });

  const isDrifted = Effect.fn("SnapshotChain.isDrifted")(function* (input: DriftInput) {
    const snapshotRef = lineSnapshotRef(input.lineRootCommitId);
    const snapshotOid = yield* resolve(input.cwd, `${snapshotRef}^{commit}`);
    const head = yield* resolve(input.cwd, "HEAD^{commit}");
    if (snapshotOid === null) {
      const status = yield* git.execute({
        operation: "SnapshotChain.isDrifted.status",
        cwd: input.cwd,
        args: ["status", "--porcelain", "--untracked-files=all"],
      });
      if (status.stdout.length > 0) return true;
      const branchTip = yield* resolve(input.cwd, `refs/heads/${input.lineBranch}^{commit}`);
      return head !== branchTip;
    }
    const snapshotTree = yield* resolve(input.cwd, `${snapshotOid}^{tree}`);
    const snapshotHead =
      (yield* resolve(input.cwd, `${snapshotOid}^2`)) ??
      (yield* resolve(input.cwd, `${snapshotOid}^1`));
    return (yield* workingTreeOid(input.cwd)) !== snapshotTree || head !== snapshotHead;
  });

  return SnapshotChain.of({
    capture,
    captureTree,
    branchMovement,
    readStanding,
    lineCommit,
    adoptRename,
    isDrifted,
  });
});

export const layer = Layer.effect(SnapshotChain, make);
