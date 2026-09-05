import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  type PlanCheckpointRecord,
} from "@t3tools/contracts";
import {
  recordedCheckpointDiffTarget,
  recordedCheckpointDiffCacheKey,
  recordedCheckpointForkInput,
} from "./checkpointDiff.ts";

const record: PlanCheckpointRecord = {
  planId: PlanId.make("plan"),
  projectId: MercurianProjectId.make("project"),
  ownerCommitId: MercurianCommitId.make("act"),
  revision: 1,
  updateSequence: 1,
};
describe("durable diff targets", () => {
  it("isolates environments, plans, acts, repositories, whitespace, and capture revisions", () => {
    const target = recordedCheckpointDiffTarget(
      EnvironmentId.make("remote"),
      record,
      MercurianRepositoryId.make("repo"),
    );
    const variants = [
      target,
      { ...target, environmentId: EnvironmentId.make("local") },
      { ...target, input: { ...target.input, planId: PlanId.make("another") } },
      { ...target, input: { ...target.input, ownerCommitId: MercurianCommitId.make("another") } },
      {
        ...target,
        input: { ...target.input, repositoryId: MercurianRepositoryId.make("another") },
      },
      { ...target, input: { ...target.input, ignoreWhitespace: true } },
      recordedCheckpointDiffTarget(
        target.environmentId,
        { ...record, revision: 2 },
        target.input.repositoryId,
      ),
    ];
    expect(new Set(variants.map(recordedCheckpointDiffCacheKey)).size).toBe(variants.length);
    expect(target.input).not.toHaveProperty("threadId");
    expect(target.input).not.toHaveProperty("turnId");
    expect(recordedCheckpointForkInput(record)).toEqual({
      planId: record.planId,
      checkpointOwnerCommitId: record.ownerCommitId,
      checkpointRevision: 1,
    });
  });
});
