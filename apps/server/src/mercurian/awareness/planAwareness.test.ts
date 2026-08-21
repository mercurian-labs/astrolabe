import {
  EnvironmentId,
  MercurianProjectId,
  PlanId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { HistoryId } from "../commitTree/schema.ts";
import type { MercurianProject, Plan } from "../planning/schema.ts";
import { planAwarenessThreadId, projectPlanAwareness } from "./planAwareness.ts";

const planId = PlanId.make("plan-1");
const projectId = MercurianProjectId.make("project-1");
const now = DateTime.makeUnsafe("2026-08-20T12:00:00.000Z");
const plan = {
  planId,
  projectId,
  historyId: HistoryId.make("history-1"),
  title: TrimmedNonEmptyString.make("Plan the awareness flow"),
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
} satisfies Plan;
const project = {
  projectId,
  name: TrimmedNonEmptyString.make("Astrolabe"),
  createdAt: now,
  updatedAt: now,
} satisfies MercurianProject;
const environmentId = EnvironmentId.make("environment-1");

describe("plan awareness", () => {
  it("uses one stable synthetic id that cannot collide with planning provider sessions", () => {
    expect(planAwarenessThreadId(planId)).toBe("mercurian:plan:plan-1");
    expect(planAwarenessThreadId(planId)).toBe(planAwarenessThreadId(planId));
    expect(planAwarenessThreadId(planId)).not.toBe("mercurian-plan-plan-1");
  });

  it.each([
    [true, true, "waiting_for_input", "Waiting for input"],
    [false, true, "waiting_for_input", "Waiting for input"],
    [true, false, "running", "Assistant is working"],
    [false, false, "completed", "Reply finished"],
  ] as const)("maps working=%s pending=%s to %s", (isWorking, hasPendingInput, phase, headline) => {
    expect(
      projectPlanAwareness({
        environmentId,
        plan,
        project,
        turnStatus: { isWorking, hasPendingInput, modelTitle: "gpt-5.4" },
        modelTitle: "gpt-5.4",
      }),
    ).toMatchObject({ phase, headline });
  });

  it("projects titles, model, timestamp, and the registered mobile plan route", () => {
    expect(
      projectPlanAwareness({
        environmentId,
        plan,
        project,
        turnStatus: null,
        modelTitle: "claude-opus-4-1",
      }),
    ).toEqual({
      environmentId,
      threadId: "mercurian:plan:plan-1",
      projectTitle: "Astrolabe",
      threadTitle: "Plan the awareness flow",
      phase: "completed",
      headline: "Reply finished",
      modelTitle: "claude-opus-4-1",
      updatedAt: "2026-08-20T12:00:00.000Z",
      deepLink: "/plans/environment-1/plan-1",
    });
  });
});
