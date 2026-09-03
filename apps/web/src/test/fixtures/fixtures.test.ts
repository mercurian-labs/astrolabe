import {
  PlanCodingSessionRecord,
  PlanDetail,
  PlanQuestion,
  PlanShell,
  PlanSpecAt,
  PlanTimelineItem,
  PlanTreeRow,
  SpecDocument,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { condensePlanGraph } from "../../components/mercurian/PlanCheckpoints.logic";
import { buildPlanGraph } from "../../components/mercurian/PlanGraph.logic";
import { planDetail, planShell, planTreeRow } from "./plan";
import { planCodingSessionRecord, planQuestion } from "./sessionsAndSplits";
import { planSpecAt, specDocument } from "./spec";
import { at, codingSessionLeaf, message, planRevision, specRevision, timeline } from "./timeline";

describe("planning fixture builders", () => {
  it("builds defaults that decode through every contract schema", () => {
    const fixtures = [
      [PlanTimelineItem, message("message")],
      [PlanTimelineItem, planRevision("plan-revision")],
      [PlanTimelineItem, specRevision("spec-revision")],
      [PlanTimelineItem, codingSessionLeaf("coding-session")],
      [PlanShell, planShell("plan")],
      [PlanTreeRow, planTreeRow("plan")],
      [PlanDetail, planDetail("plan")],
      [SpecDocument, specDocument("spec")],
      [PlanSpecAt, planSpecAt("spec")],
      [PlanCodingSessionRecord, planCodingSessionRecord("session")],
      [PlanQuestion, planQuestion("question")],
    ] as const;

    for (const [schema, fixture] of fixtures) {
      expect(() => Schema.decodeUnknownSync(schema)(fixture)).not.toThrow();
    }
  });

  it("is deterministic for identical calls", () => {
    expect(message("same", { sequence: 4, parents: ["root"] })).toEqual(
      message("same", { sequence: 4, parents: ["root"] }),
    );
    expect(planDetail("same")).toEqual(planDetail("same"));
    expect(planCodingSessionRecord("same")).toEqual(planCodingSessionRecord("same"));
  });

  it("applies overrides and derives their encoded fields", () => {
    expect(message("reply", { sequence: 7, parents: ["root"], text: "Done" })).toMatchObject({
      sequence: 7,
      createdAt: at(7),
      parents: ["root"],
      text: "Done",
    });
    expect(planRevision("split", { split: { repository: "web" } }).split).toEqual({
      repositoryId: "web",
      repositoryName: "web",
    });
    expect(specRevision("refresh", { cause: "refresh" })).toMatchObject({ cause: "refresh" });
  });

  it("throws when an assembled fixture violates its contract", () => {
    expect(() => planShell("plan", { title: "" })).toThrow();
    expect(() => message("")).toThrow();
  });

  it("composes with the production checkpoint derivation", () => {
    const items = timeline(
      message("query", { text: "Build it" }),
      planRevision("revision", {
        sequence: 2,
        parents: ["query"],
        authorKind: "assistant",
      }),
      message("response", {
        sequence: 3,
        parents: ["revision"],
        authorKind: "assistant",
        text: "Done",
      }),
    );

    expect(condensePlanGraph(buildPlanGraph(items)).nodes.map((node) => node.commitId)).toEqual([
      "response",
    ]);
  });
});
