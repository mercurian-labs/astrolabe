import { describe, expect, it } from "vite-plus/test";

import { composePlanRowStatus } from "./wire.ts";
import type { PlanTimelineItem } from "./PlanningStore.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const PLAN_TIMELINE_TAGS = ["message", "plan-revision", "spec-revision", "coding-session"] as const;
type _PlanTimelineTagsAreExact = Assert<
  Equal<(typeof PLAN_TIMELINE_TAGS)[number], PlanTimelineItem["_tag"]>
>;

const idle = { isWorking: false, hasPendingInput: false } as const;
const working = { isWorking: true, hasPendingInput: false } as const;
const pending = { isWorking: false, hasPendingInput: true } as const;

describe("planning wire coding-session status", () => {
  it("pins the planning-store timeline tags without session activity", () => {
    expect(PLAN_TIMELINE_TAGS).toEqual([
      "message",
      "plan-revision",
      "spec-revision",
      "coding-session",
    ]);
  });

  it("preserves assistant-only status", () => {
    expect(composePlanRowStatus({ isWorking: true, hasPendingInput: false }, [])).toEqual({
      isWorking: true,
      hasPendingInput: false,
    });
  });

  it("composes a running session turn", () => {
    expect(composePlanRowStatus(idle, [working])).toEqual({
      isWorking: true,
      hasPendingInput: false,
    });
  });

  it("composes a pending session approval", () => {
    expect(composePlanRowStatus(idle, [pending])).toEqual({
      isWorking: false,
      hasPendingInput: true,
    });
  });

  it("composes pending session user input", () => {
    expect(composePlanRowStatus(idle, [pending])).toEqual({
      isWorking: false,
      hasPendingInput: true,
    });
  });

  it("keeps both assistant and session signals", () => {
    expect(composePlanRowStatus({ isWorking: true, hasPendingInput: false }, [pending])).toEqual({
      isWorking: true,
      hasPendingInput: true,
    });
  });

  it("ignores ended sessions and missing thread shells", () => {
    expect(composePlanRowStatus(idle, [null])).toEqual(idle);
    expect(composePlanRowStatus(idle, [null, null])).toEqual(idle);
  });

  it("leaves a plan with no sessions byte-for-byte unchanged", () => {
    const status = { isWorking: false, hasPendingInput: true } as const;
    expect(composePlanRowStatus(status, [])).toEqual(status);
  });
});
