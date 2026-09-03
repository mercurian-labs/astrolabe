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
  useAtomValue: (atom: string) => {
    if (atom === "available-editors") return ["vscode"];
    if (atom === "keybindings") return {};
    return null;
  },
}));
vi.mock("../../state/server", () => ({
  primaryServerAvailableEditorsAtom: "available-editors",
  primaryServerKeybindingsAtom: "keybindings",
  serverEnvironment: { configValueAtom: vi.fn() },
}));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => "environment-test",
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({ isReady: true, presentation: null }),
}));
vi.mock("../../state/query", async () => {
  const Option = await import("effect/Option");
  return {
    useEnvironmentQuery: () => ({
      data: {
        versionControlSystems: [],
        sourceControlProviders: [
          {
            kind: "github",
            label: "GitHub",
            executable: "gh",
            status: "available",
            version: Option.none(),
            installHint: "Install gh.",
            detail: Option.none(),
            auth: {
              status: "authenticated",
              account: Option.none(),
              host: Option.none(),
              detail: Option.none(),
            },
          },
        ],
      },
      error: null,
      isPending: false,
      refresh: vi.fn(),
    }),
  };
});
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
        {
          repositoryId: "repository-web",
          name: "Web",
          path: "/web",
          hasGit: true,
          hosting: null,
          scripts: [],
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
  default: (props: {
    readonly gitCwd: string | null;
    readonly changeRequestsAllowed?:
      | boolean
      | ((
          provider: "github" | "gitlab" | "azure-devops" | "bitbucket" | "unknown" | null,
        ) => boolean);
  }) => {
    const gate = props.changeRequestsAllowed;
    const decide = (provider: "github" | "gitlab" | null) =>
      typeof gate === "function" ? String(gate(provider)) : String(gate ?? true);
    return (
      <div
        data-control="git-actions"
        data-git-cwd={props.gitCwd ?? ""}
        data-gate-github={decide("github")}
        data-gate-gitlab={decide("gitlab")}
      />
    );
  },
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

import {
  CodingSessionHeader,
  resolveCodingSessionMember,
  resolveCodingSessionRename,
} from "./CodingSessionHeader";

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
    // The gate is a predicate over the status-derived provider: the machine's
    // authenticated github passes, while a freshly flipped gitlab remote is
    // refused immediately — no stale hosting-cache window (M-119 walk finding).
    expect(markup).toContain('data-gate-github="true"');
    expect(markup).toContain('data-gate-gitlab="false"');
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

  it("shows a multi-repository switcher and scopes controls to the selected member", () => {
    const workspaceMembers = [
      {
        repositoryId: MercurianRepositoryId.make("repository-test"),
        worktreePath: "/slot/server",
      },
      {
        repositoryId: MercurianRepositoryId.make("repository-web"),
        worktreePath: "/slot/web",
      },
    ];
    const markup = renderToStaticMarkup(
      <CodingSessionHeader
        environmentId={environmentId}
        planId={PlanId.make("plan-test")}
        planTitle="Reviewed plan"
        threadId={threadId}
        threadTitle="Implementation session"
        threadRef={threadRef}
        worktreePath="/slot/server"
        repositoryId={null}
        workspaceMembers={workspaceMembers}
        unreachableRepositories={["Web"]}
      />,
    );

    expect(markup).toContain('aria-label="Repository"');
    expect(markup).toContain('value="repository-test" selected=""');
    expect(markup).toContain(">Astrolabe</option>");
    expect(markup).toContain(">Web</option>");
    expect(markup).toContain('data-git-cwd="/slot/server"');
    expect(markup).toContain('data-open-in-cwd="/slot/server"');
    expect(markup).toContain('data-script-cwd="/slot/server"');
    expect(markup).toContain("Grounded without Web");
    expect(resolveCodingSessionMember(workspaceMembers, "repository-web")?.worktreePath).toBe(
      "/slot/web",
    );
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
