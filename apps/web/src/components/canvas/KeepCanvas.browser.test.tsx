import {
  EnvironmentId,
  ProjectId,
  type ProjectRootCheckout,
  RootKey,
  ThreadId,
  TurnItemId,
  type WikiKeepCanvasInput,
  type WikiKeepCanvasResult,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useKeepCanvas } from "./KeepCanvas";

const state = vi.hoisted(() => ({
  roots: [] as ReadonlyArray<ProjectRootCheckout>,
  kept: [] as Array<unknown>,
  result: null as unknown,
  opened: [] as Array<unknown>,
}));

vi.mock("~/state/entities", () => ({
  useQuietThreadShell: () => ({ projectId: "project-keep" }),
}));
vi.mock("~/state/projectRoots", () => ({
  projectRootsEnvironment: { list: (target: unknown) => ({ list: target }) },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({
    data: atom === null ? null : { roots: state.roots },
    error: null,
  }),
}));
vi.mock("~/state/wiki", async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  return { wikiEnvironment: { keepCanvas: { permissionAtom: () => allowed } } };
});
vi.mock("../wiki/wikiEnvironment", () => ({
  useWikiCommand: () => async (value: { readonly input: unknown }) => {
    state.kept.push(value.input);
    return { ok: true, value: state.result };
  },
}));
vi.mock("../wiki/useOpenWiki", () => ({
  useOpenWikiTab: () => (tab: unknown) => state.opened.push(tab),
}));
vi.mock("~/rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({ openFile: (...args: Array<unknown>) => state.opened.push(args) }),
  },
}));

const board = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread-keep"),
  itemId: TurnItemId.make("item-keep"),
  title: "Refund flow",
};

const root = (key: string, overrides: Partial<ProjectRootCheckout> = {}): ProjectRootCheckout => ({
  key: RootKey.make(key),
  name: key,
  path: `/work/${key}`,
  kind: key === "app" ? "workspace" : "tracked",
  state: "git",
  hostBacked: true,
  checkout: `/work/${key}`,
  writable: true,
  ...overrides,
});

const reset = (roots: ReadonlyArray<ProjectRootCheckout>, result: unknown) => {
  state.roots = roots;
  state.result = result;
  state.kept = [];
  state.opened = [];
};

function Harness() {
  const keep = useKeepCanvas(board);
  return (
    <>
      {keep.item === undefined ? null : (
        <button type="button" onClick={keep.item.run}>
          {keep.item.label}
        </button>
      )}
      {keep.dialog}
    </>
  );
}

it("keeps in the only folder it can write without asking, and opens the file written", async () => {
  reset([root("app"), root("gone", { state: "missing", checkout: null, writable: false })], {
    rootKey: RootKey.make("app"),
    file: "Refund flow.canvas",
    changeRequest: null,
    checkout: "/work/app",
    notes: [],
  } satisfies WikiKeepCanvasResult);
  await using _screen = await render(<Harness />);

  await userEvent.click(page.getByRole("button", { name: "Keep in the project…" }));
  expect(page.getByLabelText("Folder").query()).toBeNull();
  await userEvent.click(page.getByRole("button", { name: "Place it" }));

  expect(state.kept).toEqual([
    {
      projectId: ProjectId.make("project-keep"),
      repository: "app",
      threadId: board.threadId,
      itemId: board.itemId,
      name: "Refund flow",
    } satisfies WikiKeepCanvasInput,
  ]);
  await expect
    .element(page.getByText(/Refund flow\.canvas is written in app, uncommitted/))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Open it" }));
  expect(state.opened).toEqual([
    [{ environmentId: board.environmentId, threadId: board.threadId }, "Refund flow.canvas"],
  ]);
});

it("asks which folder when several qualify, and says which change request it joined", async () => {
  reset([root("app"), root("api")], {
    rootKey: "api",
    file: "Refund flow.canvas",
    changeRequest: { changeRequestId: "cr-1", title: "Keep Refund flow" },
    notes: [],
  });
  await using _screen = await render(<Harness />);

  await userEvent.click(page.getByRole("button", { name: "Keep in the project…" }));
  await userEvent.click(page.getByLabelText("Folder"));
  await userEvent.click(page.getByRole("option", { name: "api" }));
  await userEvent.click(page.getByRole("button", { name: "Place it" }));

  expect(state.kept).toMatchObject([{ repository: "api" }]);
  await expect
    .element(page.getByText(/Refund flow\.canvas is in “Keep Refund flow” in api/))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Open it" }));
  expect(state.opened).toMatchObject([
    { kind: "note", file: "Refund flow.canvas", changeRequestId: "cr-1" },
  ]);
});
