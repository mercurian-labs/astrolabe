import { WorktreeSlotId } from "../worktreeSlots/schema.ts";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import {
  MercurianProjectId,
  MercurianRepositoryId,
  MercurianCommitId,
  PlanId,
  ThreadId,
} from "@t3tools/contracts";
import { make } from "./ProjectDocuments.ts";
import { StorageSourceStore } from "../storage/StorageSourceStore.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { PlanningStore } from "../planning/PlanningStore.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";

it.effect(
  "reads immutable document content after edits and configuration removal, without a live checkout fallback",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "project-documents-"))),
      (root) =>
        Effect.gen(function* () {
          const cwd = NodePath.join(root, "repo");
          NodeFS.mkdirSync(cwd);
          const git = (args: readonly string[]) =>
            NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
          git(["init", "--initial-branch=main"]);
          git(["config", "user.name", "Test"]);
          git(["config", "user.email", "test@example.com"]);
          NodeFS.mkdirSync(NodePath.join(cwd, "plans"));
          NodeFS.writeFileSync(NodePath.join(cwd, "plans/design.md"), "# Historical design\n");
          git(["add", "."]);
          git(["commit", "-m", "document"]);
          const threadId = ThreadId.make("thread");
          const repositoryId = MercurianRepositoryId.make("repo");
          const projectId = MercurianProjectId.make("project");
          git(["update-ref", checkpointRefForThreadTurn(threadId, 0), "HEAD"]);
          NodeFS.writeFileSync(NodePath.join(cwd, "plans/design.md"), "# Live design\n");
          const alias = NodePath.join(root, "alias.md");
          NodeFS.symlinkSync(NodePath.join(cwd, "plans/design.md"), alias);
          const now = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
          let attached = true;
          const layers = Layer.mergeAll(
            NodeServices.layer,
            Layer.mock(StorageSourceStore)({
              getSnapshot: Effect.succeed([]),
              getDocumentLocations: Effect.succeed([
                {
                  projectId,
                  repositoryId,
                  kind: "plan",
                  subpath: "plans",
                  createdAt: now,
                  updatedAt: now,
                },
              ]),
            }),
            Layer.mock(RepositoryStore)({
              getSnapshot: Effect.succeed({
                repositories: [
                  {
                    repositoryId,
                    name: "Repo",
                    path: cwd,
                    scripts: [],
                    hasGit: true,
                    hosting: null,
                    createdAt: now,
                    updatedAt: now,
                  },
                ],
                projectRepositories: [],
              }),
            }),
            Layer.mock(SlotStore)({
              listAll: Effect.sync(() =>
                attached
                  ? [
                      {
                        slotId: WorktreeSlotId.make("slot"),
                        projectId,
                        path: root,
                        currentLineRootCommitId: MercurianCommitId.make("root"),
                        members: [{ repositoryId, relativePath: "repo", currentBranch: "main" }],
                        createdAt: now,
                        lastUsedAt: now,
                      },
                    ]
                  : [],
              ),
            }),
            Layer.mock(LineRuntimeStore)({
              getByThreadId: () =>
                Effect.succeed(
                  Option.some({
                    planId: PlanId.make("plan"),
                    lineRootCommitId: MercurianCommitId.make("root"),
                  } as never),
                ),
            }),
            Layer.mock(PlanningStore)({
              getPlanSnapshot: () => Effect.succeed({ plan: { projectId }, timeline: [] } as never),
            }),
            Layer.mock(ProjectionSnapshotQuery)({
              getThreadShellById: () =>
                Effect.sync(() =>
                  Option.some({
                    workspaceMembers: attached ? [{ repositoryId, worktreePath: cwd }] : [],
                  } as never),
                ),
              getThreadCheckpointContext: () =>
                Effect.succeed(Option.some({ checkpoints: [] } as never)),
            }),
            Layer.mock(GitVcsDriver)({
              execute: (input) =>
                Effect.sync(() => ({
                  exitCode: ChildProcessSpawner.ExitCode(0),
                  stdout: NodeChildProcess.execFileSync("git", input.args, {
                    cwd: input.cwd,
                    encoding: "utf8",
                  }),
                  stderr: "",
                  stdoutTruncated: false,
                  stderrTruncated: false,
                })),
            }),
          );
          yield* Effect.gen(function* () {
            const documents = yield* make;
            assert.strictEqual(
              (yield* documents.list({ threadId, projectId })).documents[0]?.title,
              "Live design",
            );
            const historical = yield* documents.list({ threadId, projectId, turnCount: 0 });
            assert.strictEqual(historical.documents[0]?.title, "Historical design");
            assert.strictEqual(historical.documents[0]?.snapshotOid, git(["rev-parse", "HEAD"]));
            assert.strictEqual(yield* documents.isDocumentPath(root, "alias.md"), true);
            assert.strictEqual(yield* documents.isDocumentPath(cwd, "code.ts"), false);
            attached = false;
            const missing = yield* documents.list({ threadId, projectId });
            assert.strictEqual(missing.documents.length, 0);
            assert.strictEqual(missing.problems.length, 1);
            assert.strictEqual(
              (yield* documents.list({ threadId, projectId, turnCount: 0 })).documents[0]?.title,
              "Historical design",
            );
          }).pipe(Effect.provide(layers));
        }),
      (root) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
    ),
);
