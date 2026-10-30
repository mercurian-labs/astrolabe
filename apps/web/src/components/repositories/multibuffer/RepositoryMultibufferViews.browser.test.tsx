import { rebaseUpdates } from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import type {
  DocumentCallResult,
  DocumentChannel,
  DocumentSession,
} from "@t3tools/client-runtime/state/document-session";
import {
  EnvironmentId,
  ProjectId,
  type DocumentStreamItem,
  type DocumentTarget,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../../test/render";

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

const shared = vi.hoisted(() => ({ files: new Map<string, unknown>() }));
const authorityOf = (path: string) => shared.files.get(path) as Authority;

// A call arrives after the editor's update that made it, as over a connection.
const later = async <A,>(run: () => A): Promise<DocumentCallResult<A>> => {
  await Promise.resolve();
  return { ok: true, value: run() };
};

vi.mock(import("~/state/documents"), async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    documentsEnvironment: {
      channel: (
        _registry: unknown,
        _environmentId: unknown,
        target: DocumentTarget,
      ): DocumentChannel => ({
        push: (input) => later(() => authorityOf(target.relativePath).push(input)),
        save: () => later(() => authorityOf(target.relativePath).save()),
        recover: () => later(() => ({ type: "conflict" as const })),
        discard: () => later(() => undefined),
      }),
      follow: (_environmentId: EnvironmentId, session: DocumentSession) =>
        Atom.make((get) => {
          const current = authorityOf(session.subscribeInput().relativePath);
          current.connect(session);
          get.addFinalizer(() => current.disconnect(session));
          return null;
        }),
    } as never,
  };
});
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
}));
vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({ isSuccess: false, error: null, data: null })) as never,
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useProject: (() => null) as never,
  useThreadShells: (() => []) as never,
}));

import { allTabs } from "~/panes/arrangement";
import { RepositoryFileView } from "../RepositoryFileView";
import { repositoryPanes } from "../repositoryPanes";
import { repositoryTabKey } from "../repositoryTabs";
import { rememberLocationList } from "./openMultibuffer";
import { RepositoryLocationsView } from "./RepositoryMultibufferViews";

const checkout = {
  environmentId: EnvironmentId.make("multibuffer-browser"),
  projectId: ProjectId.make("project"),
  cwd: "/repo",
} as const;

const lines = (count: number, name: string) =>
  Array.from({ length: count }, (_, index) => `${name} ${index + 1}`).join("\n");

function setup(files: Record<string, string>) {
  shared.files.clear();
  for (const [path, text] of Object.entries(files)) shared.files.set(path, new Authority(text));
}

describe("RepositoryLocationsView", () => {
  it("sends typing in an excerpt to the file's other editors, and the file's to the excerpt", async () => {
    setup({ "a.ts": lines(40, "alpha"), "b.ts": lines(10, "beta") });
    const id = rememberLocationList({
      title: "References",
      locations: [
        { path: "a.ts", line: 5 },
        { path: "a.ts", line: 30 },
        { path: "b.ts", line: 2 },
      ],
    });
    await using screen = await render(
      <>
        <div data-testid="results" style={{ height: 600, display: "flex" }}>
          <RepositoryLocationsView tabKey="results" tab={{ kind: "locations", ...checkout, id }} />
        </div>
        <div data-testid="file">
          <RepositoryFileView tabKey="file" tab={{ kind: "file", ...checkout, path: "a.ts" }} />
        </div>
      </>,
    );
    const excerpts = screen.getByTestId("results").getByRole("textbox");
    const text = (locator: typeof excerpts) => locator.element().textContent ?? "";
    await vi.waitFor(() => expect(text(excerpts.nth(2))).toContain("beta 2"));
    const first = excerpts.nth(0);
    await vi.waitFor(() => expect(text(first)).toContain("alpha 5"));
    expect(first.element().textContent).not.toContain("alpha 1");
    const file = screen.getByTestId("file").getByRole("textbox");
    await vi.waitFor(() => expect(text(file)).toContain("alpha 1"));

    await userEvent.click(screen.getByTestId("results").getByText("alpha 5", { exact: true }));
    await userEvent.keyboard("{End}!");
    await vi.waitFor(() => expect(authorityOf("a.ts").doc.line(5).text).toBe("alpha 5!"));
    await vi.waitFor(() => expect(file.element().textContent).toContain("alpha 5!"));

    // The file's own editor types into the excerpt's lines.
    await userEvent.click(screen.getByTestId("file").getByText("alpha 30", { exact: true }));
    await userEvent.keyboard("{End}?");
    await vi.waitFor(() => expect(text(excerpts.nth(1))).toContain("alpha 30?"));
  });

  it("opens an excerpt's file in a file tab", async () => {
    setup({ "a.ts": lines(40, "alpha") });
    const id = rememberLocationList({
      title: "References",
      locations: [{ path: "a.ts", line: 5 }],
    });
    await using screen = await render(
      <div style={{ height: 600, display: "flex" }}>
        <RepositoryLocationsView tabKey="results" tab={{ kind: "locations", ...checkout, id }} />
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open a.ts" }));
    expect(allTabs(repositoryPanes.arrangement())).toContain(
      repositoryTabKey({ kind: "file", ...checkout, path: "a.ts" }),
    );
  });
});
