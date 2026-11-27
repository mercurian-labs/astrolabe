import {
  EnvironmentId,
  ProjectId,
  type ProjectEntry,
  type ProjectWorktree,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { dismissContextMenu } from "~/contextMenuFallback";
import { allTabs, openTab, startingArrangement } from "~/panes/arrangement";
import { workspace } from "~/panes/workspace";
import { render } from "../../../test/render";
import { ProjectMoveDialog } from "./ProjectMoveDialog";
import { repositoryTabKey } from "./repositoryTabs";
import { WorktreeFiles } from "./RepositoryWorktrees";

const environmentId = EnvironmentId.make("move-browser");
const projectId = ProjectId.make("proj");

const data = vi.hoisted(() => ({
  moves: [] as unknown[],
  toasts: [] as Array<{ readonly title: string; readonly description?: string }>,
}));

const entries: readonly ProjectEntry[] = [
  { path: "docs", kind: "directory" },
  { path: "Plan.md", kind: "file" },
];
const directory = {
  entries,
  load: () => Promise.resolve(),
  refresh: () => {},
  ready: true,
  error: null,
  isPending: false,
  loadingDirectories: new Set<string>(),
};

vi.mock("~/components/files/useDirectoryEntries", () => ({
  useDirectoryEntries: () => directory,
}));
vi.mock("~/state/queries", () => ({
  useProjectPathSearch: () => ({ entries: [], isPending: false, error: null, refresh: () => {} }),
}));
vi.mock("~/fileContextMenu", () => ({
  useFileContextMenu: () => ({ buildItems: () => [], activate: () => Promise.resolve() }),
}));
vi.mock("~/hooks/useWorkspaceMutationRefresh", () => ({ useWorkspaceMutationRefresh: () => {} }));
vi.mock(import("~/state/worktrees"), async (original) => ({
  ...(await original()),
  useWorktreeWatch: (() => null) as never,
  useWorktreeChangedFiles: (() => 0) as never,
  useProjectWorktrees: (() => ({ data: null, error: null })) as never,
}));
vi.mock(import("~/state/projectRoots"), async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const root = (key: string, name: string, path: string, kind: "workspace" | "tracked") => ({
    key,
    name,
    path,
    kind,
    state: "git",
    hostBacked: false,
    checkout: path,
    writable: true,
  });
  const roots = Atom.make(
    AsyncResult.success({
      roots: [
        root("app", "App", "/dev/app", "workspace"),
        root("notes", "Team notes", "/dev/notes", "tracked"),
      ],
    }),
  );
  return {
    projectRootsEnvironment: {
      list: () => roots,
      docPaths: () => Atom.make(AsyncResult.success({ paths: [] })),
    } as never,
  };
});
vi.mock(import("~/state/wiki"), async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    wikiEnvironment: { move: { permissionAtom: () => Atom.make(true) } } as never,
    wikiOverviewsAtom: (() => Atom.make([])) as never,
  };
});
vi.mock(import("~/state/use-atom-command"), () => ({
  useAtomCommand: (() => async (value: unknown) => {
    data.moves.push(value);
    return {
      _tag: "Success",
      value: {
        savedTo: "disk",
        changed: [{ rootKey: "app", files: ["Plan.md", "Roadmap.md"] }],
        unchanged: [{ rootKey: "notes", files: ["Index.md"] }],
      },
    };
  }) as never,
}));
vi.mock(import("../ui/toast"), async (original) => ({
  ...(await original()),
  toastManager: {
    add: (toast: { readonly title: string; readonly description?: string }) => {
      data.toasts.push(toast);
      return "toast";
    },
  } as never,
}));

function findTreeRow(path: string): HTMLElement | null {
  for (const host of document.querySelectorAll("*")) {
    const row = host.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);
    if (row) return row;
  }
  return null;
}

const worktree = {
  path: "/dev/app",
  isMain: true,
  isRepository: true,
  branch: "main",
  head: "c1",
  alias: "main",
} as ProjectWorktree;

describe("ProjectMoveDialog", () => {
  it("moves a note from its tree row with its links, and its open tab follows", async () => {
    const tab = (path: string) =>
      repositoryTabKey({
        kind: "file",
        environmentId,
        projectId,
        checkout: { cwd: "/dev/app" },
        path,
      });
    workspace.store.update(() => openTab(startingArrangement(), tab("Plan.md")));
    await using _screen = await render(
      <div style={{ display: "flex", flexDirection: "column", height: 300, width: 300 }}>
        <WorktreeFiles
          owner={{ environmentId, projectId }}
          worktree={worktree}
          projectName="App"
          selectedPath={null}
          onOpenFile={() => {}}
        />
        <ProjectMoveDialog />
      </div>,
    );
    using _menu = { [Symbol.dispose]: () => dismissContextMenu() };
    await vi.waitFor(() => expect(findTreeRow("Plan.md")).not.toBeNull());
    findTreeRow("Plan.md")!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, button: 2 }),
    );
    await userEvent.click(page.getByRole("menuitem", { name: "Move or rename…" }));

    const field = page.getByLabelText("Path");
    await expect.element(field).toHaveValue("Plan.md");
    await userEvent.clear(field);
    await userEvent.type(field, "Roadmap{Enter}");

    await vi.waitFor(() =>
      expect(data.moves).toEqual([
        {
          environmentId,
          input: {
            wikiId: "proj:app",
            checkout: "/dev/app",
            from: "Plan.md",
            to: "Roadmap.md",
          },
        },
      ]),
    );
    await vi.waitFor(() =>
      expect(data.toasts).toEqual([
        expect.objectContaining({ description: expect.stringContaining("Team notes") }),
      ]),
    );
    const open = allTabs(workspace.store.getSnapshot()!.arrangement);
    expect(open).toContain(tab("Roadmap.md"));
    expect(open).not.toContain(tab("Plan.md"));
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });
});
