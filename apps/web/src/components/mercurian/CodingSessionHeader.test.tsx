import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MercurianRepositoryId, PlanId, ThreadId } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../state/threads", () => ({
  threadEnvironment: { updateMetadata: Symbol("updateMetadata") },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => (atom === "available-editors" ? ["vscode"] : {}),
}));
vi.mock("../../state/server", () => ({
  primaryServerAvailableEditorsAtom: "available-editors",
  primaryServerKeybindingsAtom: "keybindings",
}));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => "environment-test",
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false, refresh: vi.fn() }),
}));
vi.mock("../../state/sourceControl", () => ({
  sourceControlEnvironment: { discovery: vi.fn(() => "discovery") },
}));
vi.mock("../../state/mercurianRepositories", () => ({
  useRepositories: () => ({
    snapshot: {
      repositories: [
        {
          repositoryId: "repository-test",
          name: "Astrolabe",
          path: "/repo",
          hasGit: true,
          hosting: null,
          scripts: [
            {
              scriptId: "dev",
              name: "Dev",
              command: "pnpm dev",
              isSetup: false,
            },
          ],
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
      projectRepositories: [],
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock("../../rightPanelStore", () => ({
  useRightPanelStore: (selector: (state: { readonly byThreadKey: {} }) => unknown) =>
    selector({ byThreadKey: {} }),
  selectThreadRightPanelState: () => ({ isOpen: false }),
}));
vi.mock("../GitActionsControl", () => ({
  default: (props: { readonly gitCwd: string | null }) => (
    <div data-control="git-actions" data-git-cwd={props.gitCwd ?? ""} />
  ),
}));
vi.mock("../chat/OpenInPicker", () => ({
  OpenInPicker: (props: { readonly openInCwd: string | null }) => (
    <div data-control="open-in" data-open-in-cwd={props.openInCwd ?? ""} />
  ),
}));
vi.mock("./SessionScriptsControl", () => ({
  SessionScriptsControl: (props: { readonly worktreePath: string }) => (
    <div data-control="scripts" data-script-cwd={props.worktreePath} />
  ),
}));
vi.mock("./SessionPreviewOffer", () => ({ SessionPreviewOffer: () => null }));
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
const threadRef = scopeThreadRef(environmentId, threadId);
const worktreePath = "/repo/worktrees/session";

describe("CodingSessionHeader", () => {
  it("renders the session worktree controls without delete or new-thread affordances", () => {
    const markup = renderToStaticMarkup(
      <CodingSessionHeader
        environmentId={environmentId}
        planId={PlanId.make("plan-test")}
        planTitle="Reviewed plan"
        threadId={threadId}
        threadTitle="Implementation session"
        threadRef={threadRef}
        worktreePath={worktreePath}
        repositoryId={MercurianRepositoryId.make("repository-test")}
      />,
    );

    expect(markup).toContain('aria-label="Coding session breadcrumb"');
    expect(markup).toContain('href="/plans/plan-test"');
    expect(markup).toContain("Reviewed plan");
    expect(markup).toContain("Implementation session");
    expect(markup).toContain('aria-label="Rename session Implementation session"');
    expect(markup).toContain('data-control="scripts"');
    expect(markup).toContain('data-script-cwd="/repo/worktrees/session"');
    expect(markup).toContain('data-control="open-in"');
    expect(markup).toContain('data-open-in-cwd="/repo/worktrees/session"');
    expect(markup).toContain('data-control="git-actions"');
    expect(markup).toContain('data-git-cwd="/repo/worktrees/session"');
    expect(markup).not.toMatch(/delete|new thread/iu);
  });

  it("falls back to the Plans crumb when no plan resolves", () => {
    const markup = renderToStaticMarkup(
      <CodingSessionHeader
        environmentId={environmentId}
        planId={null}
        planTitle={null}
        threadId={threadId}
        threadTitle="Detached session"
        threadRef={threadRef}
        worktreePath={null}
        repositoryId={null}
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
