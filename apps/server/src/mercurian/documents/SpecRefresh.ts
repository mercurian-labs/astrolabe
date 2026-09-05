import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import {
  MercurianStorageError,
  PlanTurnId,
  TrackerConnectionId,
  type RefreshProjectSpecInput,
  type RefreshProjectSpecResult,
} from "@t3tools/contracts";
import { DocumentStore } from "./DocumentStore.ts";
import {
  readDocumentMarkdown,
  readSpecBody,
  refreshSpecMarkdown,
  specRevision,
} from "./markdown.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { LineRuntimeService } from "../lineRuntimes/LineRuntimeService.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { CommitId } from "../commitTree/schema.ts";
import { WorkspaceFileSystem } from "../../workspace/WorkspaceFileSystem.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import { SlotService } from "../worktreeSlots/SlotService.ts";
import { SnapshotChain, lineExtraSnapshotRef } from "../worktreeSlots/SnapshotChain.ts";
import { TrackerStore } from "../trackers/TrackerStore.ts";
import { specDocumentFromIssue } from "@t3tools/contracts";

/** A refresh holds the same line claim as a turn, including across filesystem and snapshot writes. */
export const make = Effect.gen(function* () {
  const documents = yield* DocumentStore;
  const runtimes = yield* LineRuntimeStore;
  const runtimeService = yield* LineRuntimeService;
  const turns = yield* PlanTurnRegistry;
  const files = yield* WorkspaceFileSystem;
  const slots = yield* SlotStore;
  const slotService = yield* SlotService;
  const snapshots = yield* SnapshotChain;
  const trackers = yield* TrackerStore;
  return Effect.fn("SpecRefresh.refresh")(
    function* (
      input: RefreshProjectSpecInput,
    ): Effect.fn.Return<RefreshProjectSpecResult, unknown> {
      const runtime = Option.getOrThrow(yield* runtimes.getByThreadId(input.threadId));
      const root = runtime.lineRootCommitId;
      if (!root) return yield* new MercurianStorageError({ operation: "line-unavailable" });
      const claim = PlanTurnId.make(NodeCrypto.randomUUID());
      yield* turns.open({
        planId: runtime.planId,
        threadId: input.threadId,
        turnId: claim,
        parentCommitId: CommitId.make(root),
        tipCommitId: CommitId.make(root),
      });
      return yield* Effect.gen(function* () {
        const origin = Option.getOrThrow(yield* documents.get(input.documentId));
        if (origin.repositoryId !== input.repositoryId)
          return yield* new MercurianStorageError({ operation: "spec-origin-repository-mismatch" });
        const ensured = yield* runtimeService.ensureSlot({
          threadId: input.threadId,
          holder: { kind: "turn" },
        });
        return yield* Effect.gen(function* () {
          const slot = Option.getOrThrow(yield* slots.get(ensured.slotId));
          if (slot.projectId !== origin.projectId)
            return yield* new MercurianStorageError({ operation: "spec-origin-project-mismatch" });
          const member = slot.members.find(
            (candidate) => candidate.repositoryId === input.repositoryId,
          );
          if (!member?.currentBranch)
            return yield* new MercurianStorageError({ operation: "spec-repository-unavailable" });
          const cwd = `${slot.path}/${member.relativePath}`;
          const current = yield* files.readFile({ cwd, relativePath: input.relativePath });
          const parsed = readDocumentMarkdown(current.contents, input.relativePath);
          const revision = parsed.metadata?.origin?.revision;
          const local = readSpecBody(current.contents);
          if (parsed.metadata?.id !== input.documentId || !revision || !local)
            return yield* new MercurianStorageError({
              operation: "spec-origin-or-sections-missing",
            });
          const base = Option.getOrThrow(yield* documents.baseline(input.documentId, revision));
          const issue = yield* trackers.getIssue({
            connectionId: TrackerConnectionId.make(origin.connectionId),
            issueId: origin.issueId,
          });
          if (!issue) return yield* new MercurianStorageError({ operation: "issue-unavailable" });
          const upstream = specDocumentFromIssue(issue.title, issue.description);
          const upstreamRevision = specRevision(upstream.goal, upstream.acceptanceCriteria);
          if (upstreamRevision === revision) return { kind: "unchanged" } as const;
          const expectedHash = NodeCrypto.createHash("sha256")
            .update(current.contents)
            .digest("hex");
          const reconciliation = {
            kind: "reconciliation-required" as const,
            base,
            local,
            upstream,
            expectedHash,
          };
          const confirming =
            input.resolvedDocument !== undefined && input.reviewedUpstream !== undefined;
          const localChanged = specRevision(local.goal, local.acceptanceCriteria) !== revision;
          if (confirming) {
            if (
              input.expectedHash !== expectedHash ||
              specRevision(
                input.reviewedUpstream!.goal,
                input.reviewedUpstream!.acceptanceCriteria,
              ) !== upstreamRevision
            )
              return reconciliation;
          } else if (
            localChanged &&
            specRevision(local.goal, local.acceptanceCriteria) !== upstreamRevision
          )
            return reconciliation;
          const resolved = confirming ? input.resolvedDocument! : upstream;
          const contents = refreshSpecMarkdown(
            current.contents,
            resolved.goal,
            resolved.acceptanceCriteria,
            upstreamRevision,
          );
          // Recheck after the network read; an editor may have changed the worktree in the meantime.
          if (
            (yield* files.readFile({ cwd, relativePath: input.relativePath })).contents !==
            current.contents
          )
            return yield* new MercurianStorageError({ operation: "spec-changed-during-refresh" });
          yield* documents.saveBaseline(input.documentId, upstreamRevision, upstream);
          yield* files.writeFile({ cwd, relativePath: input.relativePath, contents });
          const now = yield* DateTime.now;
          const snapshot = yield* snapshots.capture({
            cwd,
            repositoryId: input.repositoryId,
            lineRootCommitId: root,
            lineBranch: member.currentBranch,
            kind: "external",
            ref: lineExtraSnapshotRef(root, "external", now),
          });
          const branchMovement = yield* snapshots.branchMovement({
            cwd,
            previousOid: snapshot.previousOid,
            lineRootCommitId: root,
            repositoryId: input.repositoryId,
            lineBranch: member.currentBranch,
          });
          const branchTipOid = yield* snapshots.lineCommit({
            cwd,
            lineRootCommitId: root,
            repositoryId: input.repositoryId,
            lineBranch: member.currentBranch,
          });
          const facts = {
            snapshotOid: snapshot.oid,
            kind: "external" as const,
            branchTipOid,
            departedRef: null,
            branchMovement,
          };
          yield* runtimes.recordRepositorySnapshot(input.threadId, input.repositoryId, facts);
          if (runtime.homeRepositoryId === input.repositoryId)
            yield* runtimes.recordSnapshot(input.threadId, facts);
          return { kind: "saved", snapshotOid: snapshot.oid } as const;
        }).pipe(
          Effect.ensuring(
            slotService
              .release(ensured.slotId, { kind: "turn", threadId: input.threadId })
              .pipe(Effect.orDie),
          ),
        );
      }).pipe(Effect.ensuring(turns.close(runtime.planId, claim)));
    },
    Effect.mapError(
      (cause) => new MercurianStorageError({ operation: "refreshProjectSpec", cause }),
    ),
  );
});
