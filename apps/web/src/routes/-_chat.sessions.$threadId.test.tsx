import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  MercurianCommitId,
  MercurianRepositoryId,
  PlanId,
  ThreadId,
} from "@t3tools/contracts";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../components/ChatView", () => ({
  default: (props: {
    readonly threadId: ThreadId;
    readonly routeKind: string;
    readonly headerContent?: ReactNode;
    readonly planPanel?: ReactNode;
  }) => (
    <div data-route-kind={props.routeKind}>
      {props.headerContent}
      {props.planPanel}
      Chat {props.threadId}
    </div>
  ),
}));

vi.mock("../components/mercurian/SessionPlanPanel", () => ({
  SessionPlanPanel: (props: { readonly planId: PlanId; readonly sessionLeafCommitId: string }) => (
    <div data-session-plan-panel={`${props.planId}:${props.sessionLeafCommitId}`}>
      Standing plan
    </div>
  ),
}));

vi.mock("../components/mercurian/CodingSessionHeader", () => ({
  CodingSessionHeader: (props: {
    readonly planId: PlanId | null;
    readonly planTitle: string | null;
    readonly threadTitle: string;
    readonly threadRef: { readonly environmentId: string; readonly threadId: string };
    readonly worktreePath: string | null;
    readonly repositoryId: string | null;
  }) => (
    <nav
      aria-label="Coding session breadcrumb"
      data-thread-ref={`${props.threadRef.environmentId}:${props.threadRef.threadId}`}
      data-worktree-path={props.worktreePath ?? ""}
      data-repository-id={props.repositoryId ?? ""}
    >
      <a href={props.planId === null ? "/" : `/plans/${props.planId}`}>
        {props.planTitle ?? "Plans"}
      </a>
      <span>{props.threadTitle}</span>
    </nav>
  ),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      ...props
    }: Omit<ComponentProps<"a">, "href"> & {
      readonly to: string;
      readonly params?: Readonly<Record<string, string>>;
    }) => (
      <a {...props} href={to.replace(/\$(\w+)/g, (_match, key: string) => params?.[key] ?? "")} />
    ),
  };
});

import { SessionThreadRouteContent } from "./_chat.sessions.$threadId";

const environmentId = EnvironmentId.make("environment-test");
const threadId = ThreadId.make("thread-test");
const threadRef = scopeThreadRef(environmentId, threadId);
const worktreePath = "/repo/worktrees/session";
const repositoryId = MercurianRepositoryId.make("repository-test");

describe("session thread route", () => {
  it("renders ChatView for an existing thread", () => {
    const markup = renderToStaticMarkup(
      <SessionThreadRouteContent
        environmentId={environmentId}
        threadId={threadId}
        threadSyncPhase={null}
        renderState="ready"
        shellExists
        planId={PlanId.make("plan-test")}
        sessionLeafCommitId={MercurianCommitId.make("session-leaf")}
        planTitle="Reviewed plan"
        threadTitle="Coding session title"
        threadRef={threadRef}
        worktreePath={worktreePath}
        repositoryId={repositoryId}
      />,
    );

    expect(markup).toContain('data-route-kind="server"');
    expect(markup).toContain("Chat thread-test");
    expect(markup).toContain('aria-label="Coding session breadcrumb"');
    expect(markup).toContain('href="/plans/plan-test"');
    expect(markup).toContain("Reviewed plan");
    expect(markup).toContain("Coding session title");
    expect(markup).toContain('data-thread-ref="environment-test:thread-test"');
    expect(markup).toContain('data-worktree-path="/repo/worktrees/session"');
    expect(markup).toContain('data-repository-id="repository-test"');
    expect(markup).toContain('data-session-plan-panel="plan-test:session-leaf"');
    expect(markup).toContain("Standing plan");
    expect(markup).not.toContain("Thread breadcrumb");
    expect(markup).not.toContain("New thread in");
    expect(markup).not.toContain("Session unavailable");
  });

  it("renders a quiet plan link when the thread is missing", () => {
    const markup = renderToStaticMarkup(
      <SessionThreadRouteContent
        environmentId={environmentId}
        threadId={threadId}
        threadSyncPhase={null}
        renderState="missing"
        shellExists={false}
        planId={PlanId.make("plan-test")}
        sessionLeafCommitId={MercurianCommitId.make("session-leaf")}
        planTitle="Reviewed plan"
        threadTitle="Coding session title"
        threadRef={threadRef}
        worktreePath={worktreePath}
        repositoryId={repositoryId}
      />,
    );

    expect(markup).toContain("Session unavailable");
    expect(markup).toContain('href="/plans/plan-test"');
    expect(markup).not.toContain("Chat thread-test");

    const fallbackMarkup = renderToStaticMarkup(
      <SessionThreadRouteContent
        environmentId={environmentId}
        threadId={threadId}
        threadSyncPhase={null}
        renderState="missing"
        shellExists={false}
        planId={null}
        sessionLeafCommitId={null}
        planTitle={null}
        threadTitle="Coding session title"
        threadRef={threadRef}
        worktreePath={worktreePath}
        repositoryId={repositoryId}
      />,
    );
    expect(fallbackMarkup).toContain('href="/"');
  });

  it("omits the standing plan panel for a detached session", () => {
    const markup = renderToStaticMarkup(
      <SessionThreadRouteContent
        environmentId={environmentId}
        threadId={threadId}
        threadSyncPhase={null}
        renderState="ready"
        shellExists
        planId={null}
        sessionLeafCommitId={null}
        planTitle={null}
        threadTitle="Detached session"
        threadRef={threadRef}
        worktreePath={null}
        repositoryId={null}
      />,
    );

    expect(markup).not.toContain("data-session-plan-panel");
    expect(markup).not.toContain("Standing plan");
  });
});
