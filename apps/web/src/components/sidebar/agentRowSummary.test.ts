import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveAgentRowSummary,
  resolveUsualAgentInstanceIds,
  usualAgentKey,
  type AgentRowSummaryInput,
} from "./agentRowSummary";

const quiet: AgentRowSummaryInput = {
  thread: {
    branch: "main",
    worktreePath: null,
    runtime: null,
    modelSelection: { instanceId: "codex" },
  },
  project: { workspaceRoot: "/dev/astrolabe", repositoryIdentity: { name: "astrolabe" } },
  hasUnsentDraft: false,
  checkout: null,
  pullRequest: { badge: null, status: null, link: null },
  usualAgentInstanceId: "codex",
  agentName: "Codex",
};
const summarize = (
  overrides: Partial<Omit<AgentRowSummaryInput, "thread">> & {
    readonly thread?: Partial<AgentRowSummaryInput["thread"]>;
  },
) =>
  resolveAgentRowSummary({
    ...quiet,
    ...overrides,
    thread: { ...quiet.thread, ...overrides.thread },
  });
const pullRequestStatus = (
  number: number,
  state: "open" | "merged" | "closed",
  options: { readonly isDraft?: boolean; readonly kind?: string } = {},
) => ({
  pr: { number, state, isDraft: options.isDraft },
  sourceControlProvider: { kind: options.kind ?? "github" },
});

describe("a sidebar thread row's second line", () => {
  it("is absent for a thread on the default branch with the usual agent", () => {
    expect(summarize({})).toBeNull();
    expect(summarize({ thread: { branch: "master" } })).toBeNull();
    expect(summarize({ thread: { branch: null } })).toBeNull();
  });

  it("drops the repository's name from the front of a branch", () => {
    const branch = (name: string, project: AgentRowSummaryInput["project"] = quiet.project) =>
      summarize({ thread: { branch: name }, project })?.branch?.text;
    expect(branch("astrolabe/foundation-layout-theme-branding")).toBe(
      "foundation-layout-theme-branding",
    );
    expect(branch("Astrolabe/fix")).toBe("fix");
    expect(branch("t3/fix-sidebar")).toBe("t3/fix-sidebar");
    expect(branch("astrolabe-old/fix")).toBe("astrolabe-old/fix");
    expect(branch("astrolabe/")).toBe("astrolabe/");
    expect(branch("astrolabe/fix", null)).toBe("astrolabe/fix");
  });

  it("takes the repository's name from its git identity or its folder", () => {
    const branch = (name: string, project: AgentRowSummaryInput["project"]) =>
      summarize({ thread: { branch: name }, project })?.branch?.text;
    expect(
      branch("repo/fix", { workspaceRoot: "/dev/checkout", repositoryIdentity: { name: "repo" } }),
    ).toBe("fix");
    expect(
      branch("checkout/fix", { workspaceRoot: "/dev/checkout/", repositoryIdentity: null }),
    ).toBe("fix");
    expect(branch("astrolabe/fix", { workspaceRoot: "C:\\dev\\astrolabe" })).toBe("fix");
  });

  it("takes a fork's own name when its git identity is the upstream it tracks", () => {
    const fork = {
      workspaceRoot: "/dev/worktrees/foundation",
      repositoryIdentity: {
        name: "t3code",
        rootPath: "/dev/mercurian/astrolabe",
        origin: { displayName: "mercurian-labs/astrolabe" },
      },
    };
    const branch = (name: string) =>
      summarize({ thread: { branch: name }, project: fork })?.branch?.text;
    expect(branch("astrolabe/collab-identity")).toBe("collab-identity");
    expect(branch("t3code/fix")).toBe("fix");
    expect(branch("mercurian-labs/fix")).toBe("mercurian-labs/fix");
  });

  it("hides the default branch the checkout reports, and shows main when it is not the default", () => {
    expect(
      summarize({
        thread: { branch: "develop" },
        checkout: { refName: "develop", isDefaultRef: true },
      }),
    ).toBeNull();
    expect(
      summarize({ thread: { branch: "main" }, checkout: { refName: "main", isDefaultRef: false } })
        ?.branch,
    ).toEqual({ text: "main", worktree: false });
    // A status for another branch (the checkout moved) says nothing about this one.
    expect(
      summarize({
        thread: { branch: "main" },
        checkout: { refName: "develop", isDefaultRef: true },
      }),
    ).toBeNull();
    expect(summarize({ thread: { branch: "develop" } })?.branch?.text).toBe("develop");
  });

  it("marks a branch the thread works on in its own worktree", () => {
    expect(
      summarize({ thread: { branch: "astrolabe/fix", worktreePath: "/w/fix" } })?.branch,
    ).toEqual({ text: "fix", worktree: true });
    expect(
      summarize({ thread: { branch: "astrolabe/fix", worktreePath: "  " } })?.branch?.worktree,
    ).toBe(false);
  });

  it("names the pull request with its state", () => {
    const text = (pullRequest: Partial<AgentRowSummaryInput["pullRequest"]>) =>
      summarize({ pullRequest: { ...quiet.pullRequest, ...pullRequest } })?.pullRequest;
    expect(text({ status: pullRequestStatus(130, "open") })).toBe("PR #130 open");
    expect(text({ status: pullRequestStatus(130, "open", { isDraft: true }) })).toBe(
      "PR #130 draft",
    );
    expect(text({ status: pullRequestStatus(130, "merged") })).toBe("PR #130 merged");
    expect(text({ status: pullRequestStatus(130, "closed") })).toBe("PR #130 closed");
    expect(text({ status: pullRequestStatus(7, "open", { kind: "gitlab" }) })).toBe("MR #7 open");
    // The current link before its status loads.
    expect(text({ link: { number: 7 } })).toBe("PR #7");
    expect(
      text({ link: { number: 130 }, badge: { kind: "pull-request", others: 0, state: "merged" } }),
    ).toBe("PR #130");
    expect(
      text({ link: { number: 130 }, badge: { kind: "pull-request", others: 2, state: "open" } }),
    ).toBe("3 PRs open");
    expect(text({ badge: { kind: "stack", layers: 2, state: "draft" } })).toBe(
      "2 stacked PRs draft",
    );
  });

  it("names the agent only when it is not the usual one", () => {
    const claude = { modelSelection: { instanceId: "claude" } };
    expect(summarize({ thread: claude, agentName: "Claude" })?.agent).toBe("Claude");
    // The running instance is the one that counts.
    expect(
      summarize({ thread: { ...claude, runtime: { providerInstanceId: "codex" } } }),
    ).toBeNull();
    expect(summarize({ thread: claude, usualAgentInstanceId: null })).toBeNull();
    expect(summarize({ thread: claude, agentName: null })).toBeNull();
  });

  it("tags an unsent draft", () => {
    expect(summarize({ hasUnsentDraft: true })).toEqual({
      draft: true,
      branch: null,
      pullRequest: null,
      agent: null,
    });
  });
});

describe("the usual agent", () => {
  const P = ProjectId.make("p");
  const Q = ProjectId.make("q");
  const thread = (
    environmentId: string,
    projectId: ProjectId,
    instanceId: string,
    running?: string,
  ) => ({
    environmentId,
    projectId,
    modelSelection: { instanceId },
    runtime: running === undefined ? null : { providerInstanceId: running },
  });
  const selection = (instanceId: string) => ({
    instanceId: ProviderInstanceId.make(instanceId),
    model: "model",
  });
  const configs = (entries: Record<string, Partial<ServerSettings>>) =>
    new Map(
      Object.entries(entries).map(([environmentId, settings]) => [
        environmentId,
        { settings: { ...DEFAULT_SERVER_SETTINGS, ...settings } },
      ]),
    );
  const key = (environmentId: string, projectId: ProjectId) =>
    usualAgentKey({ environmentId, projectId });

  it("is the default the project's new threads start with", () => {
    const usual = resolveUsualAgentInstanceIds(
      [
        [
          thread("local", P, "codex"),
          thread("local", Q, "claudeAgent"),
          thread("local", Q, "claudeAgent"),
        ],
      ],
      configs({
        local: {
          defaultModelSelection: selection("codex"),
          projectSettingsOverrides: { [P]: { defaultModelSelection: selection("claudeAgent") } },
        },
      }),
      new Map(),
    );
    expect(usual.get(key("local", P))).toBe("claudeAgent");
    expect(usual.get(key("local", Q))).toBe("codex");
  });

  it("reads a project's own default from the project until settings fold it in", () => {
    const usual = resolveUsualAgentInstanceIds(
      [[thread("local", P, "codex")]],
      configs({ local: { defaultModelSelection: selection("codex") } }),
      new Map([[key("local", P), { defaultModelSelection: selection("claudeAgent") }]]),
    );
    expect(usual.get(key("local", P))).toBe("claudeAgent");
  });

  it("is otherwise the agent most listed threads run with, per environment", () => {
    const usual = resolveUsualAgentInstanceIds(
      [
        [thread("local", P, "claude"), thread("local", Q, "codex")],
        [thread("local", P, "claude", "codex"), thread("remote", P, "claude")],
        [thread("local", P, "codex")],
      ],
      configs({ local: {} }),
      new Map(),
    );
    expect(usual.get(key("local", P))).toBe("codex");
    expect(usual.get(key("local", Q))).toBe("codex");
    expect(usual.get(key("remote", P))).toBe("claude");
    expect(usual.get(key("elsewhere", P))).toBeUndefined();
  });

  it("settles a tie the same way whatever order the rows are in", () => {
    const tied = [thread("local", P, "codex"), thread("local", P, "claude")];
    const forward = resolveUsualAgentInstanceIds([tied], configs({}), new Map());
    const reversed = resolveUsualAgentInstanceIds([tied.toReversed()], configs({}), new Map());
    expect(forward.get(key("local", P))).toBe("claude");
    expect(reversed.get(key("local", P))).toBe("claude");
  });
});
