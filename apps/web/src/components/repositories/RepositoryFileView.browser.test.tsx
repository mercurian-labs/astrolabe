import { rebaseUpdates } from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import type {
  DocumentCallResult,
  DocumentChannel,
  DocumentSession,
} from "@t3tools/client-runtime/state/document-session";
import {
  EnvironmentId,
  type LanguageServerRoutes,
  ProjectId,
  type DocumentStreamItem,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";

/** The environment's side of one file: `@codemirror/collab`'s authority loop and a disk. */
class Authority {
  doc: Text;
  disk: string | null;
  updates: Array<{ readonly clientID: string; readonly changes: ChangeSet }> = [];
  savedVersion = 0;
  private readonly connected = new Set<DocumentSession>();

  constructor(text: string) {
    this.doc = Text.of(text.split("\n"));
    this.disk = text;
  }

  private send(item: DocumentStreamItem) {
    for (const session of this.connected) session.receive(item);
  }

  private sendDisk() {
    this.send({ type: "disk", savedVersion: this.savedVersion, missing: this.disk === null });
  }

  connect(session: DocumentSession) {
    this.connected.add(session);
    session.receive({
      type: "snapshot",
      loadId: "load",
      version: this.updates.length,
      text: this.doc.toString(),
      savedVersion: this.savedVersion,
      missing: this.disk === null,
    });
  }

  disconnect(session: DocumentSession) {
    this.connected.delete(session);
  }

  push(input: Parameters<DocumentChannel["push"]>[0]) {
    const incoming = input.updates.map((update) => ({
      clientID: update.clientId,
      changes: ChangeSet.fromJSON(update.changes),
    }));
    const accepted = rebaseUpdates(incoming, this.updates.slice(input.version));
    const version = this.updates.length;
    for (const update of accepted) {
      this.doc = update.changes.apply(this.doc);
      this.updates.push(update);
    }
    this.send({
      type: "updates",
      version,
      updates: accepted.map((update) => ({
        clientId: update.clientID,
        changes: update.changes.toJSON(),
      })),
    });
    return { version: this.updates.length };
  }

  save() {
    this.disk = this.doc.toString();
    this.savedVersion = this.updates.length;
    this.sendDisk();
    return { savedVersion: this.savedVersion };
  }

  removeDisk() {
    this.disk = null;
    this.sendDisk();
  }
}

const shared = vi.hoisted(() => ({
  authority: null as unknown,
  routes: null as unknown,
  started: [] as unknown[],
  runContextAtom: null as unknown,
}));
const authority = () => shared.authority as Authority;

// A call arrives after the editor's update that made it, as over a connection.
const later = async <A,>(run: () => A): Promise<DocumentCallResult<A>> => {
  await Promise.resolve();
  return { ok: true, value: run() };
};

vi.mock(import("~/state/documents"), async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    documentsEnvironment: {
      channel: (): DocumentChannel => ({
        push: (input) => later(() => authority().push(input)),
        save: () => later(() => authority().save()),
        recover: () => later(() => ({ type: "conflict" as const })),
        discard: () => later(() => undefined),
      }),
      follow: (_environmentId: EnvironmentId, session: DocumentSession) =>
        Atom.make((get) => {
          const current = authority();
          current.connect(session);
          get.addFinalizer(() => current.disconnect(session));
          return null;
        }),
    } as never,
  };
});
vi.mock(import("~/state/languageServers"), async (original) => {
  const { languageServersEnvironment } = await original();
  const { Atom } = await import("effect/reactivity");
  return {
    languageServersEnvironment: {
      ...languageServersEnvironment,
      routes: ((...args: Parameters<typeof languageServersEnvironment.routes>) =>
        shared.routes ?? languageServersEnvironment.routes(...args)) as never,
      session: (() => Atom.make(null)) as never,
      runContext: (() => shared.runContextAtom) as never,
    },
  };
});
vi.mock(import("./runTabs"), async (original) => ({
  ...(await original()),
  startRun: (async (tab: unknown) => void shared.started.push(tab)) as never,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
}));
vi.mock(import("~/state/query"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  const { Atom } = await import("effect/reactivity");
  const nothing = Atom.make(null);
  return {
    ...(await original()),
    // The run context stays an atom: a query's answer re-renders the file on its own.
    useEnvironmentQuery: ((atom: Atom.Atom<unknown> | null) => ({
      isSuccess: false,
      error: null,
      data: useAtomValue(atom !== null && atom === shared.runContextAtom ? atom : nothing),
    })) as never,
  };
});
vi.mock(import("./ProjectDocumentView"), () => ({
  default: ({ tab }: { readonly tab: { readonly path: string } }) => (
    <p data-testid="document-editor">{tab.path}</p>
  ),
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useProject: (() => null) as never,
  useThreadShells: (() => []) as never,
}));

import { RegistryContext } from "@effect/atom-react";
import { hasLanguageServer } from "@mercurian/editor/lsp";
import { EditorView } from "@codemirror/view";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { getClientSettings, updateClientSettings } from "~/hooks/useSettings";
import { revertEditedFile } from "../files/revertEditedFile";
import { RepositoryFileView } from "./RepositoryFileView";

const tab = {
  kind: "file",
  environmentId: EnvironmentId.make("documents-browser"),
  projectId: ProjectId.make("project"),
  checkout: { cwd: "/repo" },
  cwd: "/repo",
  checkoutName: "repo",
  path: "notes.txt",
} as const;

function setup(text: string) {
  shared.authority = new Authority(text);
  shared.started = [];
  const runContext = Atom.make<unknown>(null);
  shared.runContextAtom = runContext;
  return runContext;
}

const RUST_TAB = { ...tab, path: "src/main.rs" };

const TRUSTED = {
  trusted: true,
  root: "",
  python: "python3",
  shell: "posix",
  testRunner: null,
  packageRunner: "npx",
  buildTool: null,
  buildCommand: null,
};

describe("RepositoryFileView", () => {
  it("opens a project's note in the document editor and its code in the code editor", async () => {
    setup("hello\n");
    await using screen = await render(
      <RepositoryFileView tabKey="note" tab={{ ...tab, path: "docs/Plan.md" }} />,
    );
    await expect.element(screen.getByTestId("document-editor")).toHaveTextContent("docs/Plan.md");
    await screen.rerender(<RepositoryFileView tabKey="code" tab={{ ...tab, path: "src/a.ts" }} />);
    await expect.element(screen.getByRole("textbox")).toHaveTextContent("hello");
    expect(screen.container.querySelector("[data-testid=document-editor]")).toBeNull();
  });

  it("keeps a note in a thread's linked tab, and a skill map, in the code editor", async () => {
    setup("plain words\n");
    const linked = { preview: () => undefined, saved: () => undefined };
    await using screen = await render(
      <RepositoryFileView tabKey="linked" tab={{ ...tab, path: "Plan.md" }} linked={linked} />,
    );
    await expect.element(screen.getByRole("textbox")).toHaveTextContent("plain words");
    await screen.rerender(
      <RepositoryFileView tabKey="map" tab={{ ...tab, path: "a.skillmap.md" }} />,
    );
    await expect.element(screen.getByRole("textbox")).toHaveTextContent("plain words");
    expect(screen.container.querySelector("[data-testid=document-editor]")).toBeNull();
  });

  it("shows typing in one editor in another editor of the same file, then saves", async () => {
    setup("hello\n");
    await using screen = await render(
      <>
        <div data-testid="first">
          <RepositoryFileView tabKey="first" tab={tab} />
        </div>
        <div data-testid="second">
          <RepositoryFileView tabKey="second" tab={tab} />
        </div>
      </>,
    );
    const first = screen.getByTestId("first").getByRole("textbox");
    const second = screen.getByTestId("second").getByRole("textbox");
    await expect.element(second).toHaveTextContent("hello");

    await userEvent.click(first);
    await userEvent.keyboard("typed");
    await vi.waitFor(() => expect(second.element().textContent).toContain("typed"));
    expect(second.element().textContent).toBe(first.element().textContent);
    expect(authority().doc.toString()).toContain("typed");
    await expect.element(screen.getByTestId("second").getByText("Saving…")).toBeVisible();

    authority().save();
    await expect.element(screen.getByTestId("first").getByText("Saved")).toBeVisible();
    await expect.element(screen.getByTestId("second").getByText("Saved")).toBeVisible();
  });

  it("keeps its undo history when it closes and opens again on the same text", async () => {
    setup("hello\n");
    await using screen = await render(<RepositoryFileView tabKey="linked" tab={tab} />);
    await expect.element(screen.getByRole("textbox")).toHaveTextContent("hello");
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.keyboard("typed");
    await vi.waitFor(() => expect(authority().doc.toString()).toContain("typed"));
    authority().save();
    await expect.element(screen.getByText("Saved")).toBeVisible();

    // A linked file tab going to Preview and back to Edit.
    await screen.rerender(<div />);
    await screen.rerender(<RepositoryFileView tabKey="linked" tab={tab} />);
    await expect.element(screen.getByRole("textbox")).toHaveTextContent("hellotyped");
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(authority().doc.toString()).toBe("hello\n"));
  });

  it("takes a language server on and off while open, keeping the editor and its text", async () => {
    setup("hello\n");
    const registry = AtomRegistry.make();
    const routes = Atom.make<AsyncResult.AsyncResult<LanguageServerRoutes>>(AsyncResult.initial());
    shared.routes = routes;
    using _routes = { [Symbol.dispose]: () => void (shared.routes = null) };
    await using screen = await render(
      <RegistryContext.Provider value={registry}>
        <RepositoryFileView tabKey="file" tab={tab} />
      </RegistryContext.Provider>,
    );
    const text = screen.getByRole("textbox");
    await expect.element(text).toHaveTextContent("hello");
    await userEvent.click(text);
    await userEvent.keyboard("typed");
    const view = EditorView.findFromDOM(text.element() as HTMLElement)!;
    expect(hasLanguageServer(view.state)).toBe(false);

    const arrive = (extensions: LanguageServerRoutes["extensions"]) =>
      act(() => registry.set(routes, AsyncResult.success({ extensions })));
    const mine = {
      server: "custom:mine",
      name: "Mine",
      languageId: "plain",
      off: false,
      toolchain: null,
    } as const;
    await arrive({ txt: [mine] });
    await vi.waitFor(() => expect(hasLanguageServer(view.state)).toBe(true));
    await arrive({});
    await vi.waitFor(() => expect(hasLanguageServer(view.state)).toBe(false));

    expect(EditorView.findFromDOM(text.element() as HTMLElement)).toBe(view);
    expect(view.state.doc.toString()).toContain("typed");
  });

  it("marks what can run while the project is trusted, moving no text, and runs it", async () => {
    const runContext = setup("fn main() {}\n");
    const registry = AtomRegistry.make();
    await using screen = await render(
      <RegistryContext.Provider value={registry}>
        <RepositoryFileView tabKey="file" tab={RUST_TAB} />
      </RegistryContext.Provider>,
    );
    const text = screen.getByRole("textbox");
    await expect.element(text).toHaveTextContent("fn main() {}");
    const left = () => text.element().getBoundingClientRect().left;
    const marker = () => document.querySelector<HTMLElement>(".atlas-run-marker");
    await vi.waitFor(() => expect(document.querySelector(".atlas-run-gutter")).not.toBeNull());
    const before = left();
    expect(marker()).toBeNull();

    await act(() => registry.set(runContext, TRUSTED));
    await vi.waitFor(() => expect(marker()?.title).toBe("cargo run"));
    expect(left()).toBe(before);

    await userEvent.click(marker()!);
    expect(shared.started).toEqual([
      {
        kind: "run",
        environmentId: tab.environmentId,
        cwd: "/repo",
        directory: "",
        path: "src/main.rs",
        name: "Run main.rs",
        command: "cargo run",
      },
    ]);

    await act(() => registry.set(runContext, { ...TRUSTED, trusted: false }));
    await vi.waitFor(() => expect(marker()).toBeNull());
    expect(left()).toBe(before);
  });

  it("takes the markers away with the setting, and brings them back", async () => {
    const runContext = setup("fn main() {}\n");
    const registry = AtomRegistry.make();
    registry.set(runContext, TRUSTED);
    using _keep = { [Symbol.dispose]: registry.mount(runContext) };
    const { runMarkers } = getClientSettings();
    using _setting = { [Symbol.dispose]: () => updateClientSettings({ runMarkers }) };
    await using screen = await render(
      <RegistryContext.Provider value={registry}>
        <RepositoryFileView tabKey="file" tab={RUST_TAB} />
      </RegistryContext.Provider>,
    );
    const marker = () => document.querySelector(".atlas-run-marker");
    await vi.waitFor(() => expect(marker()).not.toBeNull());

    await act(() => updateClientSettings({ runMarkers: false }));
    await vi.waitFor(() => expect(document.querySelector(".atlas-run-gutter")).toBeNull());
    await act(() => updateClientSettings({ runMarkers: true }));
    await vi.waitFor(() => expect(marker()).not.toBeNull());
    expect(screen.getByRole("textbox").element().textContent).toContain("fn main");
  });

  it("reverts to the agent's version as one edit that undo takes back and redo makes again", async () => {
    setup("one\ntwo\n");
    await using screen = await render(<RepositoryFileView tabKey="only" tab={tab} />);
    const editor = screen.getByRole("textbox");
    await expect.element(editor).toHaveTextContent("onetwo");
    await userEvent.click(editor);
    await userEvent.keyboard("{Control>}{End}{/Control}mine");
    await vi.waitFor(() => expect(authority().doc.toString()).toBe("one\ntwo\nmine"));
    authority().save();

    const onSaved = vi.fn();
    const target = {
      registry: AtomRegistry.make(),
      environmentId: tab.environmentId,
      cwd: "/repo",
      path: tab.path,
      onSaved,
    };
    const reverting = revertEditedFile(target, { text: "one\r\ntwo\r\n", missing: false });
    await vi.waitFor(() => expect(authority().doc.toString()).toBe("one\ntwo\n"));
    // What the environment's autosave does.
    authority().save();
    const reverted = await reverting;
    if (!reverted.ok || reverted.undo === null) throw new Error("Expected an undoable revert");
    expect(onSaved).toHaveBeenCalledTimes(1);

    await userEvent.click(editor);
    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(authority().doc.toString()).toBe("one\ntwo\nmine"));
    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    await vi.waitFor(() => expect(authority().doc.toString()).toBe("one\ntwo\n"));

    // The toast's Undo puts back the text from before, as one more edit.
    const undoing = reverted.undo();
    await vi.waitFor(() => expect(authority().doc.toString()).toBe("one\ntwo\nmine"));
    authority().save();
    expect(await undoing).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(authority().doc.toString()).toBe("one\ntwo\n"));
  });

  it("reverts a file no editor has open through a document of its own, and undoes it", async () => {
    setup("one\ntwo\nmine\n");
    const onSaved = vi.fn();
    const target = {
      registry: AtomRegistry.make(),
      environmentId: tab.environmentId,
      cwd: "/repo",
      path: tab.path,
      onSaved,
    };
    const reverted = await revertEditedFile(target, { text: "one\ntwo\n", missing: false });
    if (!reverted.ok || reverted.undo === null) throw new Error("Expected an undoable revert");
    expect(authority().disk).toBe("one\ntwo\n");
    expect(onSaved).toHaveBeenCalledTimes(1);

    expect(await reverted.undo()).toBeNull();
    expect(authority().disk).toBe("one\ntwo\nmine\n");
    // It no longer reads as the revert left it: nothing is put back over it.
    expect(await reverted.undo()).not.toBeNull();
    expect(authority().disk).toBe("one\ntwo\nmine\n");
  });

  it("offers to save a deleted file with unsaved edits, and saving recreates it", async () => {
    setup("kept\n");
    await using screen = await render(<RepositoryFileView tabKey="only" tab={tab} />);
    const editor = screen.getByRole("textbox");
    await expect.element(editor).toHaveTextContent("kept");

    authority().removeDisk();
    await userEvent.click(editor);
    await userEvent.keyboard("more ");
    await expect
      .element(screen.getByText("This file was deleted. Save to recreate it, or discard."))
      .toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await expect.element(screen.getByText("Saved")).toBeVisible();
    expect(authority().disk).toContain("more ");
  });
});
