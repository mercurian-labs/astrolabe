import { EnvironmentId, PlanId, ThreadId } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../state/threads", () => ({
  threadEnvironment: { updateMetadata: Symbol("updateMetadata") },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
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
}));

import { CodingSessionHeader, resolveCodingSessionRename } from "./CodingSessionHeader";

const environmentId = EnvironmentId.make("environment-test");
const threadId = ThreadId.make("thread-test");

describe("CodingSessionHeader", () => {
  it("renders the owning plan crumb and session title without thread or git affordances", () => {
    const markup = renderToStaticMarkup(
      <CodingSessionHeader
        environmentId={environmentId}
        planId={PlanId.make("plan-test")}
        planTitle="Reviewed plan"
        threadId={threadId}
        threadTitle="Implementation session"
      />,
    );

    expect(markup).toContain('aria-label="Coding session breadcrumb"');
    expect(markup).toContain('href="/plans/plan-test"');
    expect(markup).toContain("Reviewed plan");
    expect(markup).toContain("Implementation session");
    expect(markup).toContain('aria-label="Rename session Implementation session"');
    expect(markup).not.toMatch(/delete|new thread|git actions|open in|scripts/iu);
  });

  it("falls back to the Plans crumb when no plan resolves", () => {
    const markup = renderToStaticMarkup(
      <CodingSessionHeader
        environmentId={environmentId}
        planId={null}
        planTitle={null}
        threadId={threadId}
        threadTitle="Detached session"
      />,
    );

    expect(markup).toContain('href="/"');
    expect(markup).toContain("Plans");
    expect(markup).toContain("Detached session");
  });

  it("uses the shared explicit rename commit rule so generated completion cannot win", () => {
    expect(
      resolveCodingSessionRename({
        title: "  My durable rename  ",
        originalTitle: "Generated title",
      }),
    ).toEqual({ action: "commit", title: "My durable rename" });
    expect(
      resolveCodingSessionRename({
        title: " My durable rename ",
        originalTitle: "My durable rename",
      }),
    ).toEqual({ action: "noop" });
  });
});
