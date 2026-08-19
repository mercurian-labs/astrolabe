import { EnvironmentId, PlanId, ThreadId } from "@t3tools/contracts";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../components/ChatView", () => ({
  default: (props: {
    readonly threadId: ThreadId;
    readonly routeKind: string;
    readonly headerContent?: ReactNode;
  }) => (
    <div data-route-kind={props.routeKind}>
      {props.headerContent}
      Chat {props.threadId}
    </div>
  ),
}));

vi.mock("../components/mercurian/CodingSessionHeader", () => ({
  CodingSessionHeader: (props: {
    readonly planId: PlanId | null;
    readonly planTitle: string | null;
    readonly threadTitle: string;
  }) => (
    <nav aria-label="Coding session breadcrumb">
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
        planTitle="Reviewed plan"
        threadTitle="Coding session title"
      />,
    );

    expect(markup).toContain('data-route-kind="server"');
    expect(markup).toContain("Chat thread-test");
    expect(markup).toContain('aria-label="Coding session breadcrumb"');
    expect(markup).toContain('href="/plans/plan-test"');
    expect(markup).toContain("Reviewed plan");
    expect(markup).toContain("Coding session title");
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
        planTitle="Reviewed plan"
        threadTitle="Coding session title"
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
        planTitle={null}
        threadTitle="Coding session title"
      />,
    );
    expect(fallbackMarkup).toContain('href="/"');
  });
});
