import { describe, expect, it } from "vite-plus/test";
import { MercurianCommitId, PlanId, type PlanReconstruction } from "@t3tools/contracts";
import { buildPlanGraph } from "./PlanGraph.logic";
import { reconstructionBoundaryLabel } from "./SessionReconstruction.logic";

const record: PlanReconstruction = {
  id: "record",
  planId: PlanId.make("plan"),
  version: 1,
  sessionStartMessageCommitId: MercurianCommitId.make("query"),
  throughCommitId: null,
  verbatimFromCommitId: MercurianCommitId.make("query"),
  compacted: null,
};

describe("reconstruction boundary reading", () => {
  it("uses start of history only for a record without compaction", () => {
    expect(reconstructionBoundaryLabel(record, buildPlanGraph([]))).toBe("Start of history");
  });
  it("preserves the recorded boundary even when its checkpoint is unavailable", () => {
    expect(
      reconstructionBoundaryLabel(
        {
          ...record,
          compacted: { summary: "A summary", throughCommitId: MercurianCommitId.make("older") },
        },
        buildPlanGraph([]),
      ),
    ).toBe("Verbatim from query");
  });
});
