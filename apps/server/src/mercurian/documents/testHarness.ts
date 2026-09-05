import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import {
  PlanId,
  ThreadId,
  MercurianProjectId,
  MercurianRepositoryId,
  MercurianCommitId,
  specDocumentFromIssue,
} from "@t3tools/contracts";
import { make } from "./SpecRefresh.ts";
import { DocumentStore, layer as DocumentStoreLive } from "./DocumentStore.ts";
import { importedSpecMarkdown, specRevision } from "./markdown.ts";
import { layerMemory } from "../persistence/Sqlite.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { LineRuntimeService } from "../lineRuntimes/LineRuntimeService.ts";
import { layer as PlanTurnRegistryLive } from "../planning/PlanTurnRegistry.ts";

import { WorkspaceFileSystem } from "../../workspace/WorkspaceFileSystem.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import { WorktreeSlotId } from "../worktreeSlots/schema.ts";
import { SlotService } from "../worktreeSlots/SlotService.ts";
import { SnapshotChain, SnapshotChainError } from "../worktreeSlots/SnapshotChain.ts";
import { TrackerStore } from "../trackers/TrackerStore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";

export const threadId = ThreadId.make("line");
export const planId = PlanId.make("plan");
export const projectId = MercurianProjectId.make("project");
export const repositoryId = MercurianRepositoryId.make("repo");
export const root = MercurianCommitId.make("root");
const slotId = WorktreeSlotId.make("slot");
const now = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
export const base = specDocumentFromIssue("Original", "Original criteria");
export const input = { threadId, documentId: "doc", repositoryId, relativePath: "specs/issue.md" };
export function harness() {
  const state = {
    contents: importedSpecMarkdown({ id: "doc", url: "https://example.com/1", ...base }),
    title: "Original",
    description: "Original criteria",
    writes: 0,
    captures: 0,
    released: 0,
    activities: 0,
    failCapture: false,
  };
  const runtime = {
    planId,
    lineRootCommitId: root,
    threadId,
    homeRepositoryId: repositoryId,
    branch: "line",
    worktreePath: "/slot/repo",
    unreachableRepositories: [],
    snapshotOid: null,
    snapshotKind: null,
    departedRef: null,
    branchMovement: null,
    lineBranchMissingOid: null,
    createdAt: now,
    updatedAt: now,
  };
  const layer = Layer.mergeAll(
    DocumentStoreLive.pipe(Layer.provide(layerMemory)),
    PlanTurnRegistryLive,
    Layer.mock(LineRuntimeStore)({
      getByThreadId: () => Effect.succeed(Option.some(runtime)),
      recordRepositorySnapshot: () => Effect.void,
      recordSnapshot: () => Effect.void,
    }),
    Layer.mock(LineRuntimeService)({
      ensureSlot: () => Effect.succeed({ record: runtime, slotId }),
    }),
    Layer.mock(SlotStore)({
      get: () =>
        Effect.succeed(
          Option.some({
            slotId,
            projectId,
            path: "/slot",
            currentLineRootCommitId: root,
            members: [{ repositoryId, relativePath: "repo", currentBranch: "line" }],
            createdAt: now,
            lastUsedAt: now,
          }),
        ),
    }),
    Layer.mock(SlotService)({
      release: () =>
        Effect.sync(() => {
          state.released++;
          return true;
        }),
    }),
    Layer.mock(WorkspaceFileSystem)({
      readFile: () =>
        Effect.sync(() => ({
          relativePath: input.relativePath,
          contents: state.contents,
          byteLength: state.contents.length,
          truncated: false,
        })),
      writeFile: ({ contents }) =>
        Effect.sync(() => {
          state.writes++;
          state.contents = contents;
          return { relativePath: input.relativePath };
        }),
    }),
    Layer.mock(TrackerStore)({
      getIssue: () =>
        Effect.sync(() => ({
          id: "1",
          identifier: "M-1",
          title: state.title,
          description: state.description,
          url: "https://example.com/1",
          status: "Open",
        })),
    }),
    Layer.mock(SnapshotChain)({
      capture: () =>
        Effect.suspend(() => {
          state.captures++;
          return state.failCapture
            ? Effect.fail(new SnapshotChainError({ operation: "test", cause: "injected" }))
            : Effect.succeed({
                oid: "a".repeat(40),
                previousOid: null,
                headOid: "b".repeat(40),
                headRef: "line",
                built: true,
              });
        }),
      branchMovement: () => Effect.succeed({ kind: "unchanged" }),
      lineCommit: () => Effect.succeed("b".repeat(40)),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch: () => Effect.sync(() => ({ sequence: ++state.activities })),
    }),
  );
  const setup = Effect.gen(function* () {
    const documents = yield* DocumentStore;
    yield* documents.reserve({
      documentId: "doc",
      projectId,
      repositoryId,
      relativePath: input.relativePath,
      connectionId: "tracker",
      issueId: "1",
      issueUrl: "https://example.com/1",
      imported: true,
      ...base,
    });
    yield* documents.saveBaseline("doc", specRevision(base.goal, base.acceptanceCriteria), base);
    return yield* make;
  });
  return { state, layer, setup };
}
