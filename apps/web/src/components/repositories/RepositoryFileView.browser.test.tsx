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
