import {
  EnvironmentId,
  ProjectId,
  RootKey,
  ProjectRootId,
  type ProjectRootCheckout,
  type WikiIndexResult,
  type WikiNoteResult,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import type { Arrangement } from "~/panes/arrangement";
import { PanesHostContext, type PaneArrangementStore, type PaneTabs } from "~/panes/panesHost";
import { allTabs } from "~/panes/arrangement";
import { render } from "../../../test/render";
import ProjectDocumentView from "./ProjectDocumentView";
import { repositoryTabKey } from "./repositoryTabs";

import "~/index.css";

const environmentId = EnvironmentId.make("docs-browser");
const projectId = ProjectId.make("proj");

const data = vi.hoisted(() => ({
  roots: [] as unknown[],
  notes: new Map<string, unknown>(),
  indexes: new Map<string, unknown>(),
  written: [] as unknown[],
  wikis: [] as unknown[],
  worktrees: null as unknown,
  files: new Map<string, unknown>(),
  reads: [] as Array<{ readonly kind: string; readonly input: Record<string, unknown> }>,
  assets: [] as unknown[],
}));

vi.mock(import("~/state/wiki"), async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const answer = Atom.family((key: string) => {
    const [kind, input] = JSON.parse(key) as [string, { wikiId: string; name?: string }];
    const value =
      kind === "note"
        ? data.notes.get(`${input.wikiId}${input.name}`)
        : kind === "list"
          ? { wikis: data.wikis }
          : kind === "changeRequests"
            ? { changeRequests: [] }
            : kind === "files"
              ? {
                  commit: "c1",
                  files: (input as unknown as { paths: string[] }).paths.map(
                    (path) =>
                      // A whole path asks with a leading `/`.
                      data.files.get(path.replace(/^\//, "")) ?? {
                        path,
                        exists: false,
                        file: path,
                        size: 0,
                        text: null,
                      },
                  ),
                }
              : data.indexes.get(input.wikiId);
    return Atom.make(AsyncResult.success(value));
  });
  const query =
    (kind: string) =>
    ({ input }: { readonly input: Record<string, unknown> }) => {
      data.reads.push({ kind, input });
      return answer(JSON.stringify([kind, input]));
    };
  return {
    wikiEnvironment: {
      note: query("note"),
      index: query("index"),
      list: query("list"),
      fileList: query("fileList"),
      files: query("files"),
      changeRequests: query("changeRequests"),
      autosave: { permissionAtom: () => Atom.make(true) },
      transform: { permissionAtom: () => Atom.make(true) },
    } as never,
    wikiOverviewsAtom: (() => Atom.make([])) as never,
  };
});
vi.mock(import("~/state/projectRoots"), async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const roots = Atom.make(AsyncResult.success({ roots: data.roots }));
  const indexes = Atom.family((key: string) => {
    const { reads } = JSON.parse(key) as {
      reads: Array<{ key: string; input: { wikiId: string } }>;
    };
    return Atom.make(reads.map(({ key: root, input }) => [root, data.indexes.get(input.wikiId)]));
  });
  return {
    projectRootsEnvironment: { list: () => roots } as never,
    projectIndexesAtom: indexes as never,
  };
});
vi.mock(import("~/state/worktrees"), async (original) => ({
  ...(await original()),
  useWorktreeWatch: (() => null) as never,
  useProjectWorktrees: (() => ({ data: data.worktrees, error: null })) as never,
}));
vi.mock(import("~/state/use-atom-command"), () => ({
  useAtomCommand: (() => async (value: unknown) => {
    data.written.push(value);
    return { _tag: "Success", value: {} };
  }) as never,
}));
vi.mock(import("~/state/assets"), async (original) => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const actual = await original();
  return {
    ...actual,
    assetEnvironment: {
      ...actual.assetEnvironment,
      createUrl: ((target: { readonly input: { readonly resource: unknown } }) => {
        data.assets.push(target.input.resource);
        return Atom.make(AsyncResult.success({ relativeUrl: "/a.png", expiresAt: 1e15 }));
      }) as never,
    },
  };
});
// A board's image asks for its address while it shows; the address itself isn't the point here.
vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlState: ((_environmentId: unknown, resource: unknown) => {
    data.assets.push(resource);
    return { _tag: "Loading" };
  }) as never,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
}));

const root = (
  key: string,
  path: string,
  kind: ProjectRootCheckout["kind"] = "tracked",
  hostBacked = false,
) => ({
  key: RootKey.make(key),
  name: key,
  path,
  kind,
  state: "git" as const,
  hostBacked,
  checkout: path,
  writable: true,
});

const index = (
  wikiId: string,
  notes: ReadonlyArray<string>,
  links: ReadonlyArray<{ from: string; to: string }>,
) =>
  ({
    wikiId,
    commit: "c1",
    notes: notes.map((file) => ({
      name: file.replace(/\.md$/, ""),
      file,
      outgoing: 0,
      incoming: 0,
    })),
    links,
    linkTypes: [],
    maps: [],
    bases: [],
    canvases: [],
    unresolved: [],
    errors: [],
  }) as unknown as WikiIndexResult;

function setup({ hosted = false } = {}) {
  data.written.length = 0;
  data.reads.length = 0;
  data.assets.length = 0;
  data.files = new Map();
  data.wikis = [{ wikiId: "proj:app", projectId: "proj", rootKey: "app", mainBranch: "main" }];
  data.worktrees = {
    worktrees: [{ path: "/dev/app", isMain: true, branch: "main" }],
    setAside: [],
  };
  // The roots' answer holds this array, made once with the mock.
  data.roots.splice(
    0,
    data.roots.length,
    root("app", "/dev/app", "workspace", hosted),
    root("lib", "/dev/lib"),
    root("docs", "/dev/docs"),
  );
  data.indexes = new Map([
    [
      "proj:app",
      index(
        "proj:app",
        ["Plan.md"],
        [
          { from: "Plan", to: "lib:Spec" },
          { from: "Plan", to: "Guide" },
        ],
      ),
    ],
    ["proj:lib", index("proj:lib", ["Spec.md", "Guide.md"], [{ from: "Spec", to: "app:Plan" }])],
    ["proj:docs", index("proj:docs", ["Guide.md"], [])],
  ]);
  const note: WikiNoteResult = {
    wikiId: ProjectRootId.make("proj:app"),
    commit: "c1",
    name: "Plan",
    file: "Plan.md",
    exists: true,
    source: "Read [[lib:Spec]] and [[Guide]].\n",
    outgoing: ["lib:Spec", "Guide"],
    incoming: [],
  };
  data.notes = new Map([["proj:app/Plan.md", note]]);
}

function panes() {
  let arrangement: Arrangement = {
    root: { type: "leaf", id: "p1", tabs: ["here"], active: "here" },
    focused: "p1",
    seq: 1,
  };
  const store: PaneArrangementStore = {
    getSnapshot: () => ({ arrangement, hostPaneId: null }),
    update: (change) => {
      arrangement = change(arrangement);
    },
    subscribe: () => () => {},
  };
  const tabs: PaneTabs = {
    Label: ({ children }) => children({ title: "", icon: null }),
    close: () => {},
    NewTab: () => null,
    place: () => {},
    Overlay: () => null,
    reservesTopRight: false,
  };
  return { host: { controller: store, tabs }, open: () => allTabs(arrangement) };
}

const tab = {
  kind: "file",
  environmentId,
  projectId,
  checkout: { cwd: "/dev/app" },
  cwd: "/dev/app",
  checkoutName: "main",
  path: "Plan.md",
} as const;

describe("ProjectDocumentView", () => {
  it("links across the project's folders, opening another folder's note in its own tab", async () => {
    setup();
    const { host, open } = panes();
    await using screen = await render(
      <PanesHostContext.Provider value={host}>
        <ProjectDocumentView tabKey="here" tab={tab} />
      </PanesHostContext.Provider>,
    );
    // Backlinks come from every folder, each named by its folder.
    const linksHere = screen.getByRole("region", { name: "Links here" });
    await expect.element(screen.getByRole("button", { name: "lib:Spec" }).first()).toBeVisible();
    expect(linksHere).toBeTruthy();

    // A bare name two other folders have is ambiguous: marked, never opened.
    await vi.waitFor(() =>
      expect(
        [...screen.container.querySelectorAll(".cm-wiki-link-ambiguous")].map(
          (each) => each.textContent,
        ),
      ).toEqual(["Guide"]),
    );
    expect(screen.container.querySelectorAll(".cm-wiki-link-missing")).toHaveLength(0);
    const ambiguous = [...screen.container.querySelectorAll("section button")].find(
      (each) => each.textContent === "GuideAmbiguous",
    );
    expect(ambiguous).toBeDefined();
    await userEvent.click(ambiguous!);
    expect(open()).toEqual(["here"]);

    // `lib:Spec` opens lib's own file, in lib's folder.
    const outgoing = [...screen.container.querySelectorAll("section")].find((section) =>
      section.textContent?.startsWith("Links to"),
    )!;
    await userEvent.click(
      [...outgoing.querySelectorAll("button")].find((each) => each.textContent === "lib:Spec")!,
    );
    expect(open()).toEqual([
      "here",
      repositoryTabKey({
        kind: "file",
        environmentId,
        wikiId: ProjectRootId.make("proj:lib"),
        checkout: { cwd: "/dev/lib" },
        path: "Spec.md",
      }),
    ]);
  });

  it("completes a `[[` to every folder's documents, writing another folder's with its name", async () => {
    setup();
    const { host } = panes();
    await using screen = await render(
      <PanesHostContext.Provider value={host}>
        <ProjectDocumentView tabKey="here" tab={tab} />
      </PanesHostContext.Provider>,
    );
    const editor = screen.getByRole("textbox");
    await expect.element(editor).toBeVisible();
    await userEvent.click(screen.container.querySelector(".cm-line")!);
    await userEvent.keyboard("{End}");
    // `[[` types one `[` in this syntax.
    await userEvent.keyboard(" See [[[[Spe");
    const option = screen.getByRole("option", { name: /lib:Spec/ });
    await expect.element(option).toBeVisible();
    // CodeMirror ignores Enter for its interaction delay after the list opens; a click never is.
    await userEvent.click(option);
    await vi.waitFor(() => expect(editor.element().textContent).toContain("[[lib:Spec|Spec"));
    // A project with no pull request host saves the note on disk, in the tab's own folder.
    await vi.waitFor(
      () =>
        expect(data.written.at(-1)).toMatchObject({
          environmentId,
          input: { cwd: "/dev/app", relativePath: "Plan.md" },
        }),
      { timeout: 5000 },
    );
    expect((data.written.at(-1) as { input: { contents: string } }).input.contents).toContain(
      "See [[lib:Spec|Spec",
    );
  });

  it("saves a hosted repository's main checkout on its default branch to the person's draft", async () => {
    setup({ hosted: true });
    const { host } = panes();
    await using screen = await render(
      <PanesHostContext.Provider value={host}>
        <ProjectDocumentView tabKey="here" tab={tab} />
      </PanesHostContext.Provider>,
    );
    const editor = screen.getByRole("textbox");
    await expect.element(editor).toBeVisible();
    await userEvent.click(screen.container.querySelector(".cm-line")!);
    await userEvent.keyboard("{End} More.");
    await vi.waitFor(
      () =>
        expect(data.written.at(-1)).toMatchObject({
          environmentId,
          input: { wikiId: "proj:app", document: "Plan.md", write: { kind: "text" } },
        }),
      { timeout: 5000 },
    );
    // Nothing went to disk, and no pull request opened by itself.
    expect(data.written.some((call) => JSON.stringify(call).includes("relativePath"))).toBe(false);
  });
});

const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", text: "Hello", x: 0, y: 0, width: 200, height: 100 },
    { id: "pic", type: "file", file: "assets/pic.png", x: 400, y: 0, width: 200, height: 150 },
  ],
  edges: [],
});

/** A board's file and the image it shows, as the checkout holds them. */
function withBoard() {
  data.files.set("Board.canvas", {
    path: "Board.canvas",
    exists: true,
    file: "Board.canvas",
    size: BOARD.length,
    text: BOARD,
  });
  data.files.set("assets/pic.png", {
    path: "assets/pic.png",
    exists: true,
    file: "assets/pic.png",
    size: 4,
    text: null,
  });
}

const boardTab = { ...tab, path: "Board.canvas" } as const;

const card = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`);

/** Selects a card as a press and release on it does. */
function select(element: HTMLElement) {
  const { left, top, width, height } = element.getBoundingClientRect();
  const at = { clientX: left + width / 2, clientY: top + height / 2 };
  for (const type of ["pointerdown", "pointerup"]) {
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        ...at,
      }),
    );
  }
}

async function nudgeCard() {
  await vi.waitFor(() => expect(card("a")).not.toBeNull(), { timeout: 5000 });
  select(card("a")!);
  document.querySelector<HTMLElement>(".cv-board")!.focus();
  await userEvent.keyboard("{ArrowRight}");
}

const Sized = ({ children }: { readonly children: React.ReactNode }) => (
  <div style={{ width: 1000, height: 700, display: "flex", flexDirection: "column" }}>
    {children}
  </div>
);

describe("a canvas in a Projects tab", () => {
  it("opens the board on disk and writes a card's move there through the wiki", async () => {
    setup();
    withBoard();
    vi.spyOn(Element.prototype, "setPointerCapture").mockReturnValue();
    const { host } = panes();
    await using _screen = await render(
      <PanesHostContext.Provider value={host}>
        <Sized>
          <ProjectDocumentView tabKey="here" tab={boardTab} />
        </Sized>
      </PanesHostContext.Provider>,
    );
    await vi.waitFor(() => expect(document.querySelector(".cv-board")).not.toBeNull(), {
      timeout: 5000,
    });
    // The board and its cards are read as they stand in the tab's folder.
    expect(
      data.reads.some(
        ({ kind, input }) =>
          kind === "files" &&
          input.checkout === "/dev/app" &&
          (input.paths as string[]).includes("/Board.canvas"),
      ),
    ).toBe(true);
    // Its image is the file on disk, not the committed one.
    await vi.waitFor(() =>
      expect(data.assets).toContainEqual({
        _tag: "draft-workspace-file",
        cwd: "/dev/app",
        path: "assets/pic.png",
      }),
    );
    expect(data.assets.some((each) => (each as { _tag: string })._tag === "wiki-file")).toBe(false);

    await nudgeCard();
    await vi.waitFor(
      () =>
        expect(data.written.at(-1)).toMatchObject({
          environmentId,
          input: {
            wikiId: "proj:app",
            checkout: "/dev/app",
            transform: {
              kind: "canvas",
              file: "Board.canvas",
              edits: [{ op: "move", card: "a", x: 20, y: 0 }],
            },
          },
        }),
      { timeout: 5000 },
    );
    // No draft was asked for.
    expect(data.written.some((call) => JSON.stringify(call).includes('"document"'))).toBe(false);
  });

  it("autosaves a hosted repository's main checkout to the person's draft", async () => {
    setup({ hosted: true });
    withBoard();
    vi.spyOn(Element.prototype, "setPointerCapture").mockReturnValue();
    const { host } = panes();
    await using _screen = await render(
      <PanesHostContext.Provider value={host}>
        <Sized>
          <ProjectDocumentView tabKey="here" tab={boardTab} />
        </Sized>
      </PanesHostContext.Provider>,
    );
    await nudgeCard();
    await vi.waitFor(
      () =>
        expect(data.written.at(-1)).toMatchObject({
          environmentId,
          input: {
            wikiId: "proj:app",
            document: "Board.canvas",
            write: {
              kind: "transform",
              transform: { kind: "canvas", edits: [{ op: "move", card: "a", x: 20, y: 0 }] },
            },
          },
        }),
      { timeout: 5000 },
    );
    expect(data.written.some((call) => JSON.stringify(call).includes("checkout"))).toBe(false);
  });
});

describe("a note on disk", () => {
  it("shows an embedded image as the checkout holds it", async () => {
    setup();
    data.notes.set("proj:app/Plan.md", {
      ...(data.notes.get("proj:app/Plan.md") as WikiNoteResult),
      source: "A shot:\n\n![[pic.png]]\n",
      outgoing: [],
    });
    data.files.set("pic.png", {
      path: "pic.png",
      exists: true,
      file: "assets/pic.png",
      size: 4,
      text: null,
    });
    const { host } = panes();
    await using _screen = await render(
      <PanesHostContext.Provider value={host}>
        <ProjectDocumentView tabKey="here" tab={tab} />
      </PanesHostContext.Provider>,
    );
    await vi.waitFor(
      () =>
        expect(data.assets).toContainEqual({
          _tag: "draft-workspace-file",
          cwd: "/dev/app",
          path: "assets/pic.png",
        }),
      { timeout: 5000 },
    );
    expect(
      data.reads.some(
        ({ kind, input }) =>
          kind === "files" && input.checkout === "/dev/app" && input.from === "Plan.md",
      ),
    ).toBe(true);
  });
});
