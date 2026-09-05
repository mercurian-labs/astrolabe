import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  MercurianStorageError,
  MercurianCommitId,
  PlanTurnId,
  specDocumentFromIssue,
  type MercurianImportPlanInput,
} from "@t3tools/contracts";
import { DocumentStore } from "./DocumentStore.ts";
import { importedSpecMarkdown, specRevision } from "./markdown.ts";
import { SnapshotChain } from "../worktreeSlots/SnapshotChain.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { WorkspaceFileSystem } from "../../workspace/WorkspaceFileSystem.ts";
import { StorageSourceStore } from "../storage/StorageSourceStore.ts";
import { PlanningStore } from "../planning/PlanningStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { CommitId } from "../commitTree/schema.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { LineRuntimeService } from "../lineRuntimes/LineRuntimeService.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import { SlotService } from "../worktreeSlots/SlotService.ts";

const encodeOriginKey = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));

export const make = Effect.gen(function* () {
  const storageSourceStore = yield* StorageSourceStore;
  const planningStore = yield* PlanningStore;
  const documentStore = yield* DocumentStore;
  const documentFs = yield* FileSystem.FileSystem;
  const documentSnapshots = yield* SnapshotChain;
  const workspaceFileSystem = yield* WorkspaceFileSystem;
  const lineRuntimeService = yield* LineRuntimeService;
  const lineRuntimeStore = yield* LineRuntimeStore;
  const slotStore = yield* SlotStore;
  const slotService = yield* SlotService;
  const turns = yield* PlanTurnRegistry;
  return Effect.fn("IssueImport.import")(function* (input: MercurianImportPlanInput) {
    const createdAt = yield* DateTime.now;
    const documentId = NodeCrypto.createHash("sha256")
      .update(yield* encodeOriginKey([input.connectionId, input.issue.id]))
      .digest("hex");
    const existingOrigin = yield* documentStore.get(documentId);
    const source = yield* storageSourceStore.getSource(input.projectId, "spec");
    if (Option.isNone(source) && Option.isNone(existingOrigin))
      return yield* new MercurianStorageError({
        operation: "Choose a spec location in project settings before importing an issue",
      });
    const imported = yield* planningStore.importPlan({
      projectId: input.projectId,
      connectionId: input.connectionId,
      issueId: input.issue.id,
      issueUrl: input.issue.url,
      title: input.issue.title,
      description: input.issue.description,
      createdAt,
    });
    const slug =
      input.issue.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-|-$/gu, "")
        .slice(0, 64) || "spec";
    const document = specDocumentFromIssue(input.issue.title, input.issue.description);
    const origin = Option.isSome(existingOrigin)
      ? existingOrigin.value
      : yield* documentStore.reserve({
          documentId,
          projectId: input.projectId,
          repositoryId: Option.getOrThrow(source).repositoryId,
          relativePath: [Option.getOrThrow(source).subpath, `${slug}-${documentId.slice(0, 8)}.md`]
            .filter(Boolean)
            .join("/"),
          connectionId: input.connectionId,
          issueId: input.issue.id,
          issueUrl: input.issue.url,
          imported: false,
          ...document,
        });
    if (origin.imported) return imported;
    const root = imported.detail.timeline[0];
    if (!root)
      return yield* new MercurianStorageError({
        operation: "import-root-unavailable",
      });
    const runtime = yield* lineRuntimeService.ensureThread({
      planId: imported.detail.plan.planId,
      lineRootCommitId: MercurianCommitId.make(root.commitId),
    });
    const claim = PlanTurnId.make(NodeCrypto.randomUUID());
    yield* turns.open({
      planId: runtime.planId,
      threadId: runtime.threadId,
      turnId: claim,
      parentCommitId: CommitId.make(root.commitId),
      tipCommitId: CommitId.make(root.commitId),
    });
    yield* Effect.gen(function* () {
      const ensured = yield* lineRuntimeService.ensureSlot({
        threadId: runtime.threadId,
        holder: { kind: "turn" },
      });
      yield* Effect.gen(function* () {
        const slot = Option.getOrThrow(yield* slotStore.get(ensured.slotId));
        const member = slot.members.find(
          (candidate) => candidate.repositoryId === origin.repositoryId,
        );
        if (!member?.currentBranch || !runtime.lineRootCommitId)
          return yield* new MercurianStorageError({
            operation: "spec-repository-unavailable",
          });
        const cwd = `${slot.path}/${member.relativePath}`;
        const contents = importedSpecMarkdown({
          id: documentId,
          url: origin.issueUrl,
          goal: origin.goal,
          acceptanceCriteria: origin.acceptanceCriteria,
        });
        const exists = yield* documentFs.exists(`${cwd}/${origin.relativePath}`);
        const existing = exists
          ? Option.some(
              yield* workspaceFileSystem.readFile({
                cwd,
                relativePath: origin.relativePath,
              }),
            )
          : Option.none();
        yield* documentStore.saveBaseline(
          documentId,
          specRevision(origin.goal, origin.acceptanceCriteria),
          { goal: origin.goal, acceptanceCriteria: origin.acceptanceCriteria },
        );
        if (Option.isSome(existing) && existing.value.contents !== contents)
          return yield* new MercurianStorageError({
            operation: "import-destination-already-exists",
          });
        if (Option.isNone(existing))
          yield* workspaceFileSystem.writeFile({
            cwd,
            relativePath: origin.relativePath,
            contents,
          });
        const snapshot = yield* documentSnapshots.capture({
          cwd,
          repositoryId: origin.repositoryId,
          lineRootCommitId: runtime.lineRootCommitId,
          lineBranch: member.currentBranch,
          kind: "external",
          ref: checkpointRefForThreadTurn(runtime.threadId, 0),
        });
        const branchMovement = yield* documentSnapshots.branchMovement({
          cwd,
          previousOid: snapshot.previousOid,
          lineRootCommitId: runtime.lineRootCommitId,
          repositoryId: origin.repositoryId,
          lineBranch: member.currentBranch,
        });
        const branchTipOid = yield* documentSnapshots.lineCommit({
          cwd,
          lineRootCommitId: runtime.lineRootCommitId,
          repositoryId: origin.repositoryId,
          lineBranch: member.currentBranch,
        });
        const facts = {
          snapshotOid: snapshot.oid,
          kind: "external" as const,
          branchTipOid,
          departedRef: null,
          branchMovement,
        };
        yield* lineRuntimeStore.recordRepositorySnapshot(
          runtime.threadId,
          origin.repositoryId,
          facts,
        );
        if (runtime.homeRepositoryId === origin.repositoryId)
          yield* lineRuntimeStore.recordSnapshot(runtime.threadId, facts);
        yield* documentStore.markImported(documentId);
      }).pipe(
        Effect.ensuring(
          slotService
            .release(ensured.slotId, { kind: "turn", threadId: runtime.threadId })
            .pipe(Effect.orDie),
        ),
      );
    }).pipe(Effect.ensuring(turns.close(runtime.planId, claim)));
    return imported;
  });
});
