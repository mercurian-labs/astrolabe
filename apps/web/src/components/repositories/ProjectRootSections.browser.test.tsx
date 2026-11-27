import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  RootKey,
  type ProjectRootCheckout,
  type ProjectWorktree,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ProjectRootSections } from "./ProjectRootSections";

const state = vi.hoisted(() => ({
  roots: [] as ReadonlyArray<ProjectRootCheckout>,
  listed: [] as Array<unknown>,
}));

vi.mock("~/state/projectRoots", () => ({
  projectRootsEnvironment: { list: (target: unknown) => ({ list: target }) },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (atom: { readonly list: unknown } | null) => {
    if (atom !== null) state.listed.push(atom.list);
    return { data: atom === null ? null : { roots: state.roots }, error: null };
  },
}));
vi.mock("~/state/worktrees", () => ({
  useProjectWorktrees: (owner: { readonly wikiId: string }) => ({
    data: { worktrees: [mainCheckout(decodeURIComponent(owner.wikiId.split(":")[1]!))] },
    error: null,
  }),
}));
// Each tree stands in as its folder and the root Docs would read it as.
vi.mock("./RepositoryWorktrees", () => ({
  WorktreeFiles: (props: {
    readonly worktree: ProjectWorktree;
    readonly docsOf: { readonly rootKey: string } | null;
  }) => (
    <div role="tree" aria-label={props.worktree.path}>
      {props.docsOf === null ? "all files" : `docs of ${props.docsOf.rootKey}`}
    </div>
  ),
  WorktreeHeader: () => null,
  WorktreesUnread: () => null,
}));

const mainCheckout = (key: string) =>
  ({
    path: `/elsewhere/${key}`,
    isMain: true,
    branch: "main",
  }) as ProjectWorktree;

const root = (key: string, path: string, state: ProjectRootCheckout["state"]) =>
  ({
    key: RootKey.make(key),
    name: key,
    path,
    kind: key === "app" ? "workspace" : "tracked",
    state,
    hostBacked: false,
    checkout: state === "missing" ? null : path,
    writable: state !== "missing",
  }) satisfies ProjectRootCheckout;

const project = {
  id: ProjectId.make("project-roots"),
  environmentId: EnvironmentId.make("environment"),
  title: "App",
  workspaceRoot: "/work/app",
  trackedFolders: [
    { name: "vendor", path: "/work/app/vendor" },
    { name: "docs", path: "/elsewhere/docs" },
    { name: "gone", path: "/elsewhere/gone" },
  ],
  defaultModelSelection: null,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
  scripts: [],
} satisfies EnvironmentProject;

it("gives each tracked folder outside the project folder its own section, a missing one saying so", async () => {
  state.roots = [
    root("app", "/work/app", "git"),
    root("vendor", "/work/app/vendor", "git"),
    root("docs", "/elsewhere/docs", "plain"),
    root("gone", "/elsewhere/gone", "missing"),
  ];
  await using screen = await render(
    <ProjectRootSections repository={project} docs={false} focusedTab={null} />,
  );

  expect(state.listed).toContainEqual({
    environmentId: project.environmentId,
    input: { projectId: project.id },
  });
  await expect.element(page.getByRole("button", { name: "docs" })).toBeVisible();
  await expect
    .element(page.getByRole("tree", { name: "/elsewhere/docs" }))
    .toHaveTextContent("all files");
  await expect.element(page.getByRole("button", { name: /gone/ })).toBeVisible();
  await expect
    .element(page.getByText("This folder isn't on disk any more: /elsewhere/gone"))
    .toBeVisible();
  // The project folder and the folder inside it already show in the project's own tree.
  expect(page.getByRole("button", { name: "vendor" }).query()).toBeNull();
  expect(page.getByRole("button", { name: "app" }).query()).toBeNull();

  await screen.rerender(<ProjectRootSections repository={project} docs focusedTab={null} />);
  await expect
    .element(page.getByRole("tree", { name: "/elsewhere/docs" }))
    .toHaveTextContent("docs of docs");
});

it("reads no roots for a project whose folders all sit inside it", async () => {
  state.listed = [];
  await using _screen = await render(
    <ProjectRootSections
      repository={{ ...project, trackedFolders: [{ name: "vendor", path: "/work/app/vendor" }] }}
      docs={false}
      focusedTab={null}
    />,
  );
  expect(state.listed).toEqual([]);
});
