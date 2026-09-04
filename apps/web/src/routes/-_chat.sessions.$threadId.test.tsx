import { MercurianCommitId, PlanId, ThreadId, type PlanningTreeSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveMercurianQueryPending } from "../state/mercurian";
import {
  resolveSessionRouteNavigation,
  resolveSessionThreadRedirect,
} from "./_chat.sessions.$threadId";

const planId = PlanId.make("plan-test");
const lineThreadId = ThreadId.make("line-thread");
const legacyThreadId = ThreadId.make("legacy-thread");
const snapshot = {
  projects: [],
  plans: [],
  threadPlanLinks: [
    {
      planId,
      threadId: lineThreadId,
      lineRootCommitId: MercurianCommitId.make("line-root"),
    },
    { planId, threadId: legacyThreadId },
  ],
} satisfies PlanningTreeSnapshot;

describe("session thread redirect", () => {
  it("targets the owning plan and names a current line runtime", () => {
    expect(resolveSessionThreadRedirect(snapshot, lineThreadId)).toEqual({
      planId,
      line: lineThreadId,
    });
  });

  it("targets the owning plan bare for a legacy session", () => {
    expect(resolveSessionThreadRedirect(snapshot, legacyThreadId)).toEqual({ planId });
  });

  it("does not navigate before the primary environment is known", () => {
    const emptySnapshot = { projects: [], plans: [], threadPlanLinks: [] };
    const isPending = resolveMercurianQueryPending(null, false);

    expect(resolveSessionRouteNavigation(emptySnapshot, lineThreadId, isPending)).toBeNull();
  });
});
