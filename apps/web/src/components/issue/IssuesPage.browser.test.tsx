import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
  useSearch: (() => ({ who: "all", status: "open" })) as never,
}));
vi.mock(import("~/state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  return {
    ...(await original()),
    primaryServerKeybindingsAtom: Atom.make(DEFAULT_RESOLVED_KEYBINDINGS) as never,
  };
});
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
    environments: [
      {
        environmentId: "env-1",
        label: "Local",
        serverConfig: { environment: { capabilities: { issues: true } } },
      },
    ],
  })) as never,
  useIssuesSupported: () => true,
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useProjects: () => [],
}));
vi.mock(import("~/components/ui/sidebar"), async (original) => ({
  ...(await original()),
  useSidebar: (() => ({
    isMobile: false,
    open: true,
    setOpen: () => {},
    setOpenMobile: () => {},
  })) as never,
}));
// The section's sidebar frame is the layout's; here the list renders where it stands.
vi.mock(import("./IssuesSidebar"), () => ({
  IssuesSidebarPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock(import("~/state/issues"), async (original) => ({
  ...(await original()),
  useIssueList: (() => ({
    answers: [["env-1", answer]],
    isPending: false,
    error: null,
    refresh: () => {},
    reload: () => {},
    retry: () => {},
  })) as never,
}));

const answer = {
  viewers: {},
  trackers: [
    {
      tracker: "github",
      host: "github.com",
      projectCount: 1,
      capabilities: { labels: true, assignees: true },
      configured: true,
      detail: null,
    },
  ],
  entries: [
    {
      tracker: "github",
      host: "github.com",
      scope: "owner/repo",
      key: "7",
      displayKey: "#7",
      title: "Crash on launch",
      url: "https://github.com/owner/repo/issues/7",
      author: null,
      state: { category: "open", name: "open" },
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      closedAt: null,
      assignees: [],
      labels: [],
      commentCount: 0,
      projectId: "project-1",
      projectTitle: "repo",
    },
  ],
  errors: [],
  nextCursors: {},
};

import { allTabs, startingArrangement } from "~/panes/arrangement";
import { workspace } from "~/panes/workspace";
import { IssuesPage } from "./IssuesPage";
import { issueTabKey } from "./issueTabs";

const issueKey = issueTabKey({
  environmentId: "env-1",
  projectId: "project-1",
  tracker: "github",
  host: "github.com",
  scope: "owner/repo",
  key: "7",
});

describe("IssuesPage", () => {
  it("opens a row as a tab of the shared panes and closes it on the close shortcut", async () => {
    workspace.update(() => startingArrangement());
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(<IssuesPage />);

    const row = screen.getByRole("button", { name: "#7 Crash on launch" });
    await row.click();
    expect(allTabs(workspace.arrangement())).toContain(issueKey);
    await expect.element(row).toHaveAttribute("aria-current", "page");

    await act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(allTabs(workspace.arrangement())).not.toContain(issueKey);
  });
});
