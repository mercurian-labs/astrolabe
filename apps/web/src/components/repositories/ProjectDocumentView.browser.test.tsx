import {
  EnvironmentId,
  ProjectId,
  RootKey,
  WikiId,
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
            : data.indexes.get(input.wikiId);
    return Atom.make(AsyncResult.success(value));
  });
  const query =
    (kind: string) =>
    ({ input }: { readonly input: unknown }) =>
      answer(JSON.stringify([kind, input]));
  return {
    wikiEnvironment: {
      note: query("note"),
      index: query("index"),
      list: query("list"),
      fileList: query("fileList"),
      changeRequests: query("changeRequests"),
      autosave: { permissionAtom: () => Atom.make(true) },
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
    wikiId: WikiId.make("proj:app"),
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
        wikiId: WikiId.make("proj:lib"),
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
    await userEvent.keyboard("{Enter}");
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
