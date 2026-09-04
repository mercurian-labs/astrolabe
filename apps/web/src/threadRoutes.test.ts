import { describe, expect, it, vi } from "vite-plus/test";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { PlanId, ThreadId } from "@t3tools/contracts";
import { DraftId } from "./composerDraftStore";

import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  navigateToThreadRoute,
  resolveActiveThreadRouteRef,
  resolveThreadRouteRenderState,
  resolveThreadRouteRef,
  resolveThreadRouteTarget,
} from "./threadRoutes";

const planByThread = vi.hoisted(() => new Map<string, string>());

vi.mock("./state/mercurian", () => ({
  planForThread: (threadId: string) => planByThread.get(threadId) ?? null,
}));

describe("threadRoutes", () => {
  it("navigates plan lines, upstream server threads, and drafts to their canonical routes", async () => {
    const navigate = vi.fn(() => Promise.resolve());
    const router = { navigate } as never;
    const lineRef = scopeThreadRef("env-1" as never, ThreadId.make("line-thread"));
    const newLineRef = scopeThreadRef("env-1" as never, ThreadId.make("new-line-thread"));
    const upstreamRef = scopeThreadRef("env-2" as never, ThreadId.make("upstream-thread"));
    planByThread.set(lineRef.threadId, "plan-1");

    await navigateToThreadRoute(router, { kind: "server", threadRef: lineRef });
    await navigateToThreadRoute(router, {
      kind: "server",
      threadRef: newLineRef,
      planId: PlanId.make("plan-1"),
    });
    await navigateToThreadRoute(router, { kind: "server", threadRef: upstreamRef });
    await navigateToThreadRoute(router, { kind: "draft", draftId: DraftId.make("draft-1") });

    expect(navigate).toHaveBeenNthCalledWith(1, {
      to: "/threads/$planId",
      params: { planId: "plan-1" },
      search: { line: "line-thread" },
    });
    expect(navigate).toHaveBeenNthCalledWith(2, {
      to: "/threads/$planId",
      params: { planId: "plan-1" },
      search: { line: "new-line-thread" },
    });
    expect(navigate).toHaveBeenNthCalledWith(3, {
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-2", threadId: "upstream-thread" },
    });
    expect(navigate).toHaveBeenNthCalledWith(4, {
      to: "/threads/draft/$draftId",
      params: { draftId: "draft-1" },
    });
  });
  it("builds canonical thread route params from a scoped ref", () => {
    const ref = scopeThreadRef("env-1" as never, ThreadId.make("thread-1"));

    expect(buildThreadRouteParams(ref)).toEqual({
      environmentId: "env-1",
      threadId: "thread-1",
    });
  });

  it("resolves a scoped ref only when both params are present", () => {
    expect(
      resolveThreadRouteRef({
        environmentId: "env-1",
        threadId: "thread-1",
      }),
    ).toEqual({
      environmentId: "env-1",
      threadId: "thread-1",
    });

    expect(resolveThreadRouteRef({ environmentId: "env-1" })).toBeNull();
    expect(resolveThreadRouteRef({ threadId: "thread-1" })).toBeNull();
  });

  it("builds canonical draft route params from a draft id", () => {
    expect(buildDraftThreadRouteParams(DraftId.make("draft-1"))).toEqual({
      draftId: "draft-1",
    });
  });

  it("resolves draft and server route targets", () => {
    expect(
      resolveThreadRouteTarget({
        environmentId: "env-1",
        threadId: "thread-1",
      }),
    ).toEqual({
      kind: "server",
      threadRef: {
        environmentId: "env-1",
        threadId: "thread-1",
      },
    });

    expect(
      resolveThreadRouteTarget({
        draftId: "draft-1",
      }),
    ).toEqual({
      kind: "draft",
      draftId: "draft-1",
    });
  });

  it("resolves the backing thread while a draft route is being promoted", () => {
    const target = resolveThreadRouteTarget({ draftId: "draft-1" });

    expect(
      resolveActiveThreadRouteRef(target, {
        environmentId: "env-1" as never,
        threadId: ThreadId.make("draft-thread"),
        promotedTo: scopeThreadRef("env-2" as never, ThreadId.make("server-thread")),
      }),
    ).toEqual({
      environmentId: "env-2",
      threadId: "server-thread",
    });
  });

  it("does not treat a draft's reserved thread ref as an active sidebar thread", () => {
    const target = resolveThreadRouteTarget({ draftId: "draft-1" });

    expect(
      resolveActiveThreadRouteRef(target, {
        environmentId: "env-1" as never,
        threadId: ThreadId.make("draft-thread"),
        promotedTo: null,
      }),
    ).toBeNull();
  });

  it("keeps shell-only server threads in the loading state", () => {
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: true,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: false,
        draftThreadExists: false,
      }),
    ).toBe("loading");
  });

  it("renders server details and local drafts when they are ready", () => {
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: true,
        serverThreadDetailExists: true,
        serverThreadDetailDeleted: false,
        draftThreadExists: false,
      }),
    ).toBe("ready");
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: false,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: false,
        draftThreadExists: true,
      }),
    ).toBe("ready");
  });

  it("distinguishes bootstrap loading from a missing thread", () => {
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: false,
        serverThreadShellExists: false,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: false,
        draftThreadExists: false,
      }),
    ).toBe("loading");
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: false,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: false,
        draftThreadExists: false,
      }),
    ).toBe("missing");
  });

  it("redirects deleted shell-only threads", () => {
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: true,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: true,
        draftThreadExists: false,
      }),
    ).toBe("missing");
  });
});
