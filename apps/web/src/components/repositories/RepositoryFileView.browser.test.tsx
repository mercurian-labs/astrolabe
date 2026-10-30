import { rebaseUpdates } from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import type {
  DocumentCallResult,
  DocumentChannel,
  DocumentSession,
} from "@t3tools/client-runtime/state/document-session";
import { EnvironmentId, ProjectId, type DocumentStreamItem } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

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

const shared = vi.hoisted(() => ({ authority: null as unknown }));
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

import { RepositoryFileView } from "./RepositoryFileView";

const tab = {
  kind: "file",
  environmentId: EnvironmentId.make("documents-browser"),
  projectId: ProjectId.make("project"),
  cwd: "/repo",
  path: "notes.txt",
} as const;

function setup(text: string) {
  shared.authority = new Authority(text);
}

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
