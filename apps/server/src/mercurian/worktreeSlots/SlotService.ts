import {
  CheckpointRef,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import { ServerConfig } from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { LineBranchStore } from "../commitTree/LineBranchStore.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import type { RepositoryView } from "../repositories/schema.ts";
import { SlotRegistry } from "./SlotRegistry.ts";
import { SlotStore } from "./SlotStore.ts";
import {
  type SlotLeaseHolder,
  type WorktreeSlot,
  type WorktreeSlotMember,
  WorktreeSlotId,
} from "./schema.ts";

export class SlotPoolAtCapacityError extends Schema.TaggedErrorClass<SlotPoolAtCapacityError>()(
  "SlotPoolAtCapacityError",
  { projectId: MercurianProjectId, poolSize: Schema.Number },
) {
  override get message(): string {
    return `Project ${this.projectId} has all ${this.poolSize} worktree slots in use`;
  }
}

export class SlotServiceError extends Schema.TaggedErrorClass<SlotServiceError>()(
  "SlotServiceError",
  { operation: Schema.String, cause: Schema.Unknown },
) {}

export interface ClaimSlotInput {
  readonly projectId: MercurianProjectId;
  readonly lineRootCommitId: MercurianCommitId;
  readonly holder: SlotLeaseHolder;
}

interface RepositoryLayoutMember {
  readonly repository: RepositoryView;
  readonly relativePath: string;
}

const isWithin = (path: Path.Path, parent: string, candidate: string) => {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

/** Preserve the repositories' on-disk arrangement inside a project slot. */
export function layoutProjectRepositories(
  path: Path.Path,
  repositories: ReadonlyArray<RepositoryView>,
): ReadonlyArray<RepositoryLayoutMember> {
  if (repositories.length === 0) return [];
  const directories = repositories.map((repository) => path.dirname(repository.path));
  const roots = new Set(directories.map((directory) => path.parse(directory).root));
  let common = roots.size === 1 ? directories[0]! : undefined;
  while (
    common !== undefined &&
    directories.some((directory) => !isWithin(path, common!, directory))
  ) {
    const parent = path.dirname(common);
    if (parent === common) {
      common = undefined;
      break;
    }
    common = parent;
  }
  const relativePaths =
    common === undefined
      ? repositories.map((repository) => path.basename(repository.path))
      : repositories.map((repository) => path.relative(common, repository.path));
  const usable = relativePaths.every(
    (relativePath) =>
      relativePath !== "" &&
      relativePath !== "." &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath),
  );
  const selected = usable
    ? relativePaths
    : repositories.map((repository) => path.basename(repository.path));
  if (new Set(selected).size !== selected.length) {
    throw new Error("Project repositories do not have unique slot-relative paths");
  }
  return repositories.map((repository, index) => ({
    repository,
    relativePath: selected[index]!,
  }));
}

export const slotMemberWorktreePath = (
  path: Path.Path,
  slot: WorktreeSlot,
  repositoryId: MercurianRepositoryId,
): string | null => {
  const member = slot.members.find((candidate) => candidate.repositoryId === repositoryId);
  return member === undefined ? null : path.join(slot.path, member.relativePath);
};

export const linePartialCheckpointRef = (lineRootCommitId: MercurianCommitId) =>
  CheckpointRef.make(
    `refs/t3/lines/${Buffer.from(String(lineRootCommitId), "utf8").toString("base64url")}/partial`,
  );

export class SlotService extends Context.Service<
  SlotService,
  {
    readonly claim: (
      input: ClaimSlotInput,
    ) => Effect.Effect<WorktreeSlot, SlotPoolAtCapacityError | SlotServiceError>;
    readonly release: (
      slotId: WorktreeSlotId,
      holder: SlotLeaseHolder,
    ) => Effect.Effect<boolean, SlotServiceError>;
    readonly retain: (
      slotId: WorktreeSlotId,
      holder: SlotLeaseHolder,
    ) => Effect.Effect<void, SlotServiceError>;
  }
>()("t3/mercurian/worktreeSlots/SlotService") {}

export const make = Effect.gen(function* () {
  const slots = yield* SlotStore;
  const registry = yield* SlotRegistry;
  const branches = yield* LineBranchStore;
  const repositories = yield* RepositoryStore;
  const settings = yield* ServerSettingsService;
  const config = yield* ServerConfig;
  const path = yield* Path.Path;
  const git = yield* GitWorkflowService;
  const gitDriver = yield* GitVcsDriver;
  const checkpoints = yield* CheckpointStore;

  const memberPath = (slot: WorktreeSlot, member: WorktreeSlotMember) =>
    path.join(slot.path, member.relativePath);

  const forEachMember = <A, E, R>(
    slot: WorktreeSlot,
    effect: (member: WorktreeSlotMember, worktreePath: string) => Effect.Effect<A, E, R>,
  ) =>
    Effect.forEach(slot.members, (member) => effect(member, memberPath(slot, member)), {
      discard: true,
    });

  const lock = (slot: WorktreeSlot) =>
    forEachMember(slot, (_member, worktreePath) =>
      gitDriver.execute({
        operation: "SlotService.lock",
        cwd: worktreePath,
        args: ["worktree", "lock", "--reason", "Astrolabe pooled slot lease", worktreePath],
        allowNonZeroExit: true,
      }),
    ).pipe(Effect.asVoid);

  const unlock = (slot: WorktreeSlot) =>
    forEachMember(slot, (_member, worktreePath) =>
      gitDriver.execute({
        operation: "SlotService.unlock",
        cwd: worktreePath,
        args: ["worktree", "unlock", worktreePath],
        allowNonZeroExit: true,
      }),
    ).pipe(Effect.asVoid);

  const isDirty = (worktreePath: string) =>
    gitDriver
      .execute({
        operation: "SlotService.status",
        cwd: worktreePath,
        args: ["status", "--porcelain", "--untracked-files=all"],
      })
      .pipe(Effect.map((result) => result.stdout.trim().length > 0));

  const projectMembers = Effect.fn("SlotService.projectMembers")(function* (
    projectId: MercurianProjectId,
    lineRootCommitId: MercurianCommitId,
  ) {
    const snapshot = yield* repositories.getSnapshot;
    const linkedIds = snapshot.projectRepositories
      .filter((link) => link.projectId === projectId)
      .map((link) => link.repositoryId);
    if (linkedIds.length === 0) {
      return yield* new SlotServiceError({
        operation: "claim:projectRepositories",
        cause: new Error(`Project ${projectId} has no linked repositories`),
      });
    }
    const linked = linkedIds.map((repositoryId) =>
      snapshot.repositories.find((candidate) => candidate.repositoryId === repositoryId),
    );
    if (linked.some((repository) => repository === undefined || !repository.hasGit)) {
      return yield* new SlotServiceError({
        operation: "claim:projectRepositories",
        cause: new Error(`Project ${projectId} has a missing or non-git repository`),
      });
    }
    const layout = layoutProjectRepositories(path, linked as ReadonlyArray<RepositoryView>);
    return yield* Effect.forEach(layout, (entry) =>
      Effect.gen(function* () {
        const branch = yield* branches.get({
          lineRootCommitId,
          repositoryId: entry.repository.repositoryId,
        });
        if (Option.isNone(branch)) {
          return yield* new SlotServiceError({
            operation: "claim:lineBranch",
            cause: new Error(
              `Line branch ${lineRootCommitId} is missing for ${entry.repository.repositoryId}`,
            ),
          });
        }
        return { ...entry, branch: branch.value.branch };
      }),
    );
  });

  const captureRecoveryPartials = Effect.fn("SlotService.captureRecoveryPartials")(function* (
    slot: WorktreeSlot,
  ) {
    if (slot.currentLineRootCommitId === null) return;
    for (const member of slot.members) {
      const worktreePath = memberPath(slot, member);
      if (yield* isDirty(worktreePath)) {
        yield* checkpoints.captureCheckpoint({
          cwd: worktreePath,
          checkpointRef: linePartialCheckpointRef(slot.currentLineRootCommitId),
        });
      }
    }
  });

  const switchSlot = Effect.fn("SlotService.switchSlot")(function* (
    slot: WorktreeSlot,
    lineRootCommitId: MercurianCommitId,
    desired: ReadonlyArray<{
      readonly repository: RepositoryView;
      readonly relativePath: string;
      readonly branch: string;
    }>,
    usedAt: DateTime.Utc,
  ) {
    if (Option.isSome(yield* registry.lease(slot.slotId))) {
      return yield* new SlotPoolAtCapacityError({
        projectId: slot.projectId,
        poolSize: (yield* settings.getSettings).worktreePoolSize,
      });
    }
    const desiredByRepository = new Map(
      desired.map((entry) => [entry.repository.repositoryId, entry.branch]),
    );
    for (const member of slot.members) {
      const worktreePath = memberPath(slot, member);
      if (slot.currentLineRootCommitId !== null && (yield* isDirty(worktreePath))) {
        yield* checkpoints.captureCheckpoint({
          cwd: worktreePath,
          checkpointRef: linePartialCheckpointRef(slot.currentLineRootCommitId),
        });
      }
    }
    const switched: Array<WorktreeSlotMember> = [];
    const performSwitch = Effect.gen(function* () {
      for (const member of slot.members) {
        const worktreePath = memberPath(slot, member);
        const branch = desiredByRepository.get(member.repositoryId);
        if (branch === undefined) {
          return yield* new SlotServiceError({
            operation: "switch:memberBranch",
            cause: new Error(`Missing line branch for ${member.repositoryId}`),
          });
        }
        yield* gitDriver.execute({
          operation: "SlotService.clean",
          cwd: worktreePath,
          args: ["reset", "--hard", "HEAD"],
        });
        yield* gitDriver.execute({
          operation: "SlotService.clean",
          cwd: worktreePath,
          args: ["clean", "-fd", "--", "."],
        });
        yield* gitDriver.execute({
          operation: "SlotService.checkout",
          cwd: worktreePath,
          args: ["checkout", branch],
        });
        switched.push(member);
        const checkpointRef = linePartialCheckpointRef(lineRootCommitId);
        if (yield* checkpoints.hasCheckpointRef({ cwd: worktreePath, checkpointRef })) {
          yield* checkpoints.restoreCheckpoint({ cwd: worktreePath, checkpointRef });
        }
      }
    });
    yield* performSwitch.pipe(
      Effect.onError(() =>
        Effect.forEach(
          switched.toReversed(),
          (member) => {
            if (member.currentBranch === null) return Effect.void;
            const worktreePath = memberPath(slot, member);
            return Effect.gen(function* () {
              yield* gitDriver.execute({
                operation: "SlotService.rollbackSwitch",
                cwd: worktreePath,
                args: ["reset", "--hard", "HEAD"],
                allowNonZeroExit: true,
              });
              yield* gitDriver.execute({
                operation: "SlotService.rollbackSwitch",
                cwd: worktreePath,
                args: ["checkout", member.currentBranch!],
                allowNonZeroExit: true,
              });
              if (slot.currentLineRootCommitId !== null) {
                const checkpointRef = linePartialCheckpointRef(slot.currentLineRootCommitId);
                if (yield* checkpoints.hasCheckpointRef({ cwd: worktreePath, checkpointRef })) {
                  yield* checkpoints.restoreCheckpoint({ cwd: worktreePath, checkpointRef });
                }
              }
            }).pipe(Effect.ignoreCause());
          },
          { discard: true },
        ),
      ),
    );
    const members = slot.members.map((member) => ({
      ...member,
      currentBranch: desiredByRepository.get(member.repositoryId) ?? null,
    }));
    yield* slots.assign({
      slotId: slot.slotId,
      lineRootCommitId,
      members: members.map((member) => ({
        repositoryId: member.repositoryId,
        currentBranch: member.currentBranch!,
      })),
      lastUsedAt: usedAt,
    });
    return { ...slot, currentLineRootCommitId: lineRootCommitId, members, lastUsedAt: usedAt };
  });

  const materialize = Effect.fn("SlotService.materialize")(function* (
    projectId: MercurianProjectId,
    lineRootCommitId: MercurianCommitId,
    slotNumber: number,
    desired: ReadonlyArray<{
      readonly repository: RepositoryView;
      readonly relativePath: string;
      readonly branch: string;
    }>,
    now: DateTime.Utc,
  ) {
    const slotId = WorktreeSlotId.make(`${projectId}:slot-${slotNumber}`);
    const slotPath = path.join(config.worktreesDir, String(projectId), `slot-${slotNumber}`);
    const created: Array<{ readonly repository: RepositoryView; readonly path: string }> = [];
    const slot: WorktreeSlot = {
      slotId,
      projectId,
      path: slotPath,
      currentLineRootCommitId: lineRootCommitId,
      members: desired.map((entry) => ({
        repositoryId: entry.repository.repositoryId,
        relativePath: entry.relativePath,
        currentBranch: entry.branch,
      })),
      createdAt: now,
      lastUsedAt: now,
    };
    yield* Effect.gen(function* () {
      for (const entry of desired) {
        const worktreePath = path.join(slotPath, entry.relativePath);
        yield* git.createWorktree({
          cwd: entry.repository.path,
          refName: entry.branch,
          path: worktreePath,
        });
        created.push({ repository: entry.repository, path: worktreePath });
      }
      yield* slots.create(slot);
    }).pipe(
      Effect.onError(() =>
        Effect.forEach(
          created.toReversed(),
          (entry) =>
            git
              .removeWorktree({
                cwd: entry.repository.path,
                path: entry.path,
                force: true,
              })
              .pipe(Effect.ignoreCause()),
          { discard: true },
        ),
      ),
    );
    return slot;
  });

  const claim: SlotService["Service"]["claim"] = Effect.fn("SlotService.claim")(function* (input) {
    return yield* registry
      .withProjectLock(
        input.projectId,
        Effect.gen(function* () {
          const desired = yield* projectMembers(input.projectId, input.lineRootCommitId);
          const poolSize = (yield* settings.getSettings).worktreePoolSize;
          const existing = yield* slots.list(input.projectId);
          const free: Array<WorktreeSlot> = [];
          for (const slot of existing) {
            if (Option.isNone(yield* registry.lease(slot.slotId))) free.push(slot);
          }
          const affinity = free.find(
            (slot) => slot.currentLineRootCommitId === input.lineRootCommitId,
          );
          const reusable = affinity ?? free[0];
          const now = yield* DateTime.now;
          let claimed: WorktreeSlot;
          if (reusable !== undefined) {
            if (reusable.currentLineRootCommitId === input.lineRootCommitId) {
              yield* captureRecoveryPartials(reusable);
              claimed = reusable;
            } else {
              claimed = yield* switchSlot(reusable, input.lineRootCommitId, desired, now);
            }
          } else {
            if (existing.length >= poolSize) {
              return yield* new SlotPoolAtCapacityError({ projectId: input.projectId, poolSize });
            }
            claimed = yield* materialize(
              input.projectId,
              input.lineRootCommitId,
              existing.length + 1,
              desired,
              now,
            );
          }
          yield* registry.acquire(claimed.slotId, input.holder, DateTime.formatIso(now));
          yield* lock(claimed);
          return claimed;
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          Schema.is(SlotPoolAtCapacityError)(cause) || Schema.is(SlotServiceError)(cause)
            ? cause
            : new SlotServiceError({ operation: "claim", cause }),
        ),
      );
  });

  const release: SlotService["Service"]["release"] = Effect.fn("SlotService.release")(
    function* (slotId, holder) {
      const slot = yield* slots.get(slotId);
      const free = yield* registry.release(slotId, holder);
      if (Option.isSome(slot) && free) yield* unlock(slot.value);
      return free;
    },
    Effect.mapError((cause) => new SlotServiceError({ operation: "release", cause })),
  );

  const retain: SlotService["Service"]["retain"] = Effect.fn("SlotService.retain")(
    function* (slotId, holder) {
      const slot = yield* slots.get(slotId);
      if (Option.isNone(slot)) {
        return yield* new SlotServiceError({
          operation: "retain",
          cause: new Error(`Worktree slot ${slotId} is missing`),
        });
      }
      yield* registry.withProjectLock(
        slot.value.projectId,
        registry.acquire(slotId, holder, DateTime.formatIso(yield* DateTime.now)),
      );
      yield* lock(slot.value);
    },
    Effect.mapError((cause) =>
      typeof cause === "object" &&
      cause !== null &&
      "_tag" in cause &&
      cause._tag === "SlotServiceError"
        ? cause
        : new SlotServiceError({ operation: "retain", cause }),
    ),
  );

  return SlotService.of({ claim, release, retain });
});

export const layer = Layer.effect(SlotService, make);
