import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadDiffPanelSelection, useDiffPanelStore } from "./diffPanelStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("diffPanelStore", () => {
  beforeEach(() =>
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
    }),
  );

  it("defaults each thread to branch changes when the working tree is clean", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("defaults each thread to working changes when the working tree is dirty", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "unstaged" });
  });

  it("preserves an explicit scope selection when the working tree state changes", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectTurn(THREAD_REF, TurnId.make("turn-1"), "src/app.ts");
    store.selectGitScope(THREAD_REF, "unstaged");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged" });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, " origin/main ");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("increments the reveal request when opening the same turn file again", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "turn",
      turnId,
      filePath: "src/app.ts",
      repositoryId: null,
      revealRequestId: 2,
    });
  });

  it("pins a memory comparison with its environment and trees and returns to git scopes cleanly", () => {
    const oid = "c".repeat(40);
    const selection = {
      environmentId: EnvironmentId.make("environment-2"),
      target: {
        position: {
          projectId: MercurianProjectId.make("project-1"),
          repositoryId: MercurianRepositoryId.make("repository-memory"),
          memoryRoot: "",
          lineRootCommitId: MercurianCommitId.make("line-root"),
          reading: { kind: "latest" as const },
          baselineTreeOid: oid,
          baselineSnapshotOid: null,
          baseCommitOid: oid,
          snapshotOid: null,
          treeOid: oid,
          recordedHeadOid: oid,
          headOid: oid,
          captureKind: null,
        },
        beforeTreeOid: oid,
        afterTreeOid: oid,
        paths: ["Composer.md"],
      },
    };
    useDiffPanelStore.getState().selectMemoryComparison(THREAD_REF, selection, "Composer");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "memory-comparison", selection, label: "Composer" });

    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("round-trips the whole-session selection per thread", () => {
    const otherRef = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-2"));
    useDiffPanelStore.getState().selectSessionScope(THREAD_REF);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "session" });
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, otherRef),
    ).toEqual({ kind: "branch", baseRef: null });
    expect(
      useDiffPanelStore.persist.getOptions().partialize?.(useDiffPanelStore.getState()),
    ).toMatchObject({
      byThreadKey: { "environment-1:thread-1": { kind: "session" } },
    });
  });

  it("round-trips the line-uncommitted selection without changing persistence shape", () => {
    useDiffPanelStore.getState().selectLineUncommittedScope(THREAD_REF);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "line-uncommitted" });
    expect(
      useDiffPanelStore.persist.getOptions().partialize?.(useDiffPanelStore.getState()),
    ).toMatchObject({
      byThreadKey: { "environment-1:thread-1": { kind: "line-uncommitted" } },
    });
  });

  it("leaves a whole-session selection alone while reconciling turns", () => {
    useDiffPanelStore.getState().selectSessionScope(THREAD_REF);
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [TurnId.make("turn-latest")]);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "session" });
  });

  it("reconciles a missing turn selection to the latest available turn", () => {
    const missingTurnId = TurnId.make("turn-missing");
    const latestTurnId = TurnId.make("turn-latest");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, missingTurnId, "src/app.ts");
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [latestTurnId]);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      filePath: "src/app.ts",
      repositoryId: null,
      revealRequestId: 1,
    });
  });
  it("round-trips a recorded checkpoint selection and leaves it alone while reconciling turns", () => {
    useDiffPanelStore.getState().selectCheckpoint(THREAD_REF, {
      planId: PlanId.make("plan-1"),
      ownerCommitId: MercurianCommitId.make("owner-1"),
      repositoryId: "repo-web",
    });
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [TurnId.make("turn-latest")]);
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "checkpoint",
      planId: "plan-1",
      ownerCommitId: "owner-1",
      repositoryId: "repo-web",
    });
  });
});
