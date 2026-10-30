import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import type { ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";

import { render } from "../../../test/render";
import { ProjectContentSearchDialog } from "./ProjectContentSearchDialog";

const route = vi.hoisted(() => ({ target: null as ActiveProjectTarget | null }));

vi.mock(import("~/hooks/useActiveProjectTarget"), () => ({
  useActiveProjectTarget: () => route.target,
}));

vi.mock(import("~/state/queries"), async (original) => ({
  ...(await original()),
  useProjectContentSearch: () =>
    ({
      canReadFiles: true,
      isCheckingAccess: false,
      isPending: false,
      error: null,
      hasQuery: false,
      invalidRegex: false,
      matches: [],
      searchKey: "",
      limited: false,
      truncated: false,
      canLoadMore: false,
      isLoadingMore: false,
      loadMore: () => {},
    }) as never,
}));

const scratch: ActiveProjectTarget = {
  environmentId: EnvironmentId.make("environment"),
  projectId: ProjectId.make("project"),
  cwd: "/repo/scratch",
  worktreePath: null,
  projectName: "scratch",
  threadRef: null as never,
};

function setup(target: ActiveProjectTarget | null) {
  route.target = target;
}

describe("project content search", () => {
  it("keeps the project it opened on when opening a match leaves the thread", async () => {
    setup(scratch);
    await using screen = await render(<ProjectContentSearchDialog onOpenChange={() => {}} />);
    await expect.element(page.getByPlaceholder("Search in scratch")).toBeInTheDocument();

    // A match opens in Repositories, off the thread's route, while the palette is still closing.
    route.target = null;
    await screen.rerender(<ProjectContentSearchDialog onOpenChange={() => {}} />);

    await expect.element(page.getByPlaceholder("Search in scratch")).toBeInTheDocument();
  });

  it("asks for a project when opened without one", async () => {
    setup(null);
    await using _screen = await render(<ProjectContentSearchDialog onOpenChange={() => {}} />);

    await expect.element(page.getByText("Open a project to search its files.")).toBeVisible();
  });
});
