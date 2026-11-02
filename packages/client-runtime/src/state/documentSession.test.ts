import { rebaseUpdates } from "@codemirror/collab";
import {
  ChangeSet,
  EditorState,
  type ChangeSpec,
  Text,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type {
  DocumentRecoverResult,
  DocumentStreamItem,
  DocumentSubscribeInput,
  DocumentTarget,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type DocumentCallResult,
  type DocumentChannel,
  type DocumentEditor,
  DocumentSession,
  replacingChanges,
} from "./documentSession.ts";

const target: DocumentTarget = { cwd: "/repo", relativePath: "src/a.ts" };

interface Accepted {
  readonly clientID: string;
  readonly changes: ChangeSet;
}

/**
 * The environment's side, in process: `@codemirror/collab`'s authority loop, saving, a disk, and
 * eviction. Items reach connected sessions as soon as the authority accepts something.
 */
class Authority {
  loadId = "load-1";
  private loads = 1;
  doc: Text;
  disk: string | null;
  updates: Array<Accepted> = [];
  savedVersion = 0;
  private readonly connected = new Set<DocumentSession>();

  constructor(text: string) {
    this.doc = Text.of(text.split("\n"));
    this.disk = text;
  }

  get text() {
    return this.doc.toString();
  }

  private send(item: DocumentStreamItem) {
    for (const session of this.connected) session.receive(item);
  }

  private diskState() {
    return { savedVersion: this.savedVersion, missing: this.disk === null };
  }

  connect(session: DocumentSession, input: DocumentSubscribeInput = session.subscribeInput()) {
    this.connected.add(session);
    const resume = input.resume;
    session.receive(
      resume !== undefined && resume.loadId === this.loadId && resume.version <= this.updates.length
        ? {
            type: "resumed",
            loadId: this.loadId,
            version: resume.version,
            updates: this.updates
              .slice(resume.version)
              .map((u) => ({ clientId: u.clientID, changes: u.changes.toJSON() })),
            ...this.diskState(),
          }
        : {
            type: "snapshot",
            loadId: this.loadId,
            version: this.updates.length,
            text: this.text,
            ...this.diskState(),
          },
    );
  }

  disconnect(session: DocumentSession) {
    this.connected.delete(session);
  }

  private accept(accepted: ReadonlyArray<Accepted>) {
    const version = this.updates.length;
    for (const update of accepted) {
      this.doc = update.changes.apply(this.doc);
      this.updates.push(update);
    }
    this.send({
      type: "updates",
      version,
      updates: accepted.map((u) => ({ clientId: u.clientID, changes: u.changes.toJSON() })),
    });
  }

  push(input: Parameters<DocumentChannel["push"]>[0]) {
    if (input.loadId !== this.loadId) return failed("not-loaded");
    const incoming = input.updates.map((u) => ({
      clientID: u.clientId,
      changes: ChangeSet.fromJSON(u.changes),
    }));
    const rebased = rebaseUpdates(incoming, this.updates.slice(input.version));
    if (rebased.length > 0) this.accept(rebased);
    return ok({ version: this.updates.length });
  }

  save() {
    this.disk = this.text;
    this.savedVersion = this.updates.length;
    this.send({ type: "disk", ...this.diskState() });
    return ok({ savedVersion: this.savedVersion });
  }

  /** What an agent does: write the file; the environment lands it as one update. */
  writeDisk(text: string) {
    const changes = replacingChanges(this.text, text);
    this.disk = text;
    this.accept([{ clientID: "disk", changes }]);
    this.savedVersion = this.updates.length;
    this.send({ type: "disk", ...this.diskState() });
  }

  removeDisk() {
    this.disk = null;
    this.send({ type: "disk", ...this.diskState() });
  }

  /** Nobody had it open: its edits were saved and the load dropped. */
  evict() {
    if (this.disk !== null) this.disk = this.text;
    this.loadId = `load-${++this.loads}`;
    this.updates = [];
    this.savedVersion = 0;
  }

  recover(
    input: Parameters<DocumentChannel["recover"]>[0],
  ): DocumentCallResult<DocumentRecoverResult> {
    if (input.loadId !== this.loadId) return failed("not-loaded");
    if (this.disk !== input.baseText) return ok({ type: "conflict" });
    const changes = replacingChanges(this.text, input.text);
    if (!changes.empty) this.accept([{ clientID: input.clientId, changes }]);
    return ok({ type: "accepted", version: this.updates.length });
  }

  discard(input: { readonly loadId: string }) {
    if (input.loadId !== this.loadId) return failed("not-loaded");
    if (this.disk === null) {
      this.connected.clear();
      return ok(undefined);
    }
    this.accept([{ clientID: "disk", changes: replacingChanges(this.text, this.disk) }]);
    this.savedVersion = this.updates.length;
    this.send({ type: "disk", ...this.diskState() });
    return ok(undefined);
  }
}

function ok<A>(value: A): DocumentCallResult<A> {
  return { ok: true, value };
}

function failed(reason: "not-loaded" | "unavailable"): DocumentCallResult<never> {
  return { ok: false, error: { reason, message: reason } };
}

interface Call {
  readonly kind: keyof DocumentChannel;
  /** Runs the call on the authority and settles it; resolves once the session has seen it. */
  readonly deliver: () => Promise<void>;
  /** The connection drops before the call arrives. */
  readonly drop: () => Promise<void>;
}

/** A network the test drives: each call waits until it is delivered or dropped. */
class Network implements DocumentChannel {
  readonly calls: Array<Call> = [];
  private readonly authority: Authority;

  constructor(authority: Authority) {
    this.authority = authority;
  }

  private queue<A>(kind: keyof DocumentChannel, run: () => DocumentCallResult<A>) {
    return new Promise<DocumentCallResult<A>>((resolve) => {
      const settled = new Promise<void>((done) => {
        this.calls.push({
          kind,
          deliver: () => {
            resolve(run());
            done();
            return settled;
          },
          drop: () => {
            resolve(failed("unavailable"));
            done();
            return settled;
          },
        });
      }).then(() => undefined);
    });
  }

  next(kind: keyof DocumentChannel): Call {
    const index = this.calls.findIndex((call) => call.kind === kind);
    if (index < 0) throw new Error(`No ${kind} call is waiting`);
    return this.calls.splice(index, 1)[0]!;
  }

  push: DocumentChannel["push"] = (input) => this.queue("push", () => this.authority.push(input));
  save: DocumentChannel["save"] = () => this.queue("save", () => this.authority.save());
  recover: DocumentChannel["recover"] = (input) =>
    this.queue("recover", () => this.authority.recover(input));
  discard: DocumentChannel["discard"] = (input) =>
    this.queue("discard", () => this.authority.discard(input));
}

/** What `EditorView` does for the session: apply the transaction and report it. */
class Editor implements DocumentEditor {
  state: EditorState;
  private readonly session: DocumentSession;

  constructor(session: DocumentSession) {
    const initial = session.initialState();
    if (initial === null) throw new Error("The session has no text yet");
    this.session = session;
    this.state = EditorState.create({ doc: initial.text, extensions: initial.extension });
  }

  dispatch = (transaction: Transaction | TransactionSpec) => {
    this.state = (
      transaction instanceof Transaction ? transaction : this.state.update(transaction)
    ).state;
    this.session.changed();
  };

  type(changes: ChangeSpec) {
    this.dispatch({ changes });
  }

  get text() {
    return this.state.doc.toString();
  }
}

function open(authority: Authority, clientId: string, canWrite = true) {
  const network = new Network(authority);
  const session = new DocumentSession({
    target,
    clientId,
    channel: network,
    canWrite: () => canWrite,
  });
  authority.connect(session);
  const editor = new Editor(session);
  session.attach(editor);
  return { session, editor, network };
}

describe("DocumentSession", () => {
  it("sends typing to the environment, and another editor sees it", async () => {
    const authority = new Authority("abc");
    const a = open(authority, "a");
    const b = open(authority, "b");

    a.editor.type({ from: 3, insert: "d" });
    expect(a.session.getState()).toMatchObject({ unsent: true, unsaved: true });
    await a.network.next("push").deliver();

    expect(authority.text).toBe("abcd");
    expect(b.editor.text).toBe("abcd");
    expect(a.session.getState()).toMatchObject({ status: "open", unsent: false, unsaved: true });
    authority.save();
    expect(a.session.getState().unsaved).toBe(false);
    expect(b.session.getState().unsaved).toBe(false);
  });

  it("rebases edits made at the same time, so both editors agree", async () => {
    const authority = new Authority("one two");
    const a = open(authority, "a");
    const b = open(authority, "b");

    a.editor.type({ from: 0, insert: "A " });
    b.editor.type({ from: 7, insert: " B" });
    await a.network.next("push").deliver();
    await b.network.next("push").deliver();

    expect(authority.text).toBe("A one two B");
    expect(a.editor.text).toBe("A one two B");
    expect(b.editor.text).toBe("A one two B");
    expect(b.session.getState().unsent).toBe(false);
  });

  it("keeps one push in flight, and sends what was typed meanwhile once it is confirmed", async () => {
    const authority = new Authority("");
    const a = open(authority, "a");

    a.editor.type({ from: 0, insert: "x" });
    a.editor.type({ from: 1, insert: "y" });
    expect(a.network.calls).toHaveLength(1);
    await a.network.next("push").deliver();
    expect(authority.text).toBe("x");
    await a.network.next("push").deliver();

    expect(authority.text).toBe("xy");
    expect(a.network.calls).toHaveLength(0);
    expect(a.session.getState().unsent).toBe(false);
  });

  it("an outside write lands under the edits still on their way", async () => {
    const authority = new Authority("line\n");
    const a = open(authority, "a");

    a.editor.type({ from: 0, insert: "// mine\n" });
    authority.writeDisk("line\nagent\n");
    expect(a.editor.text).toBe("// mine\nline\nagent\n");
    await a.network.next("push").deliver();

    expect(authority.text).toBe("// mine\nline\nagent\n");
    expect(a.session.getState()).toMatchObject({ unsent: false, unsaved: true });
  });

  it("catches up after a reconnect and sends what was typed offline", async () => {
    const authority = new Authority("abc");
    const a = open(authority, "a");
    const b = open(authority, "b");

    authority.disconnect(a.session);
    a.editor.type({ from: 0, insert: ">" });
    await a.network.next("push").drop();
    b.editor.type({ from: 3, insert: "<" });
    await b.network.next("push").deliver();
    expect(a.editor.text).toBe(">abc");

    authority.connect(a.session);
    expect(a.editor.text).toBe(">abc<");
    await a.network.next("push").deliver();

    expect(authority.text).toBe(">abc<");
    expect(b.editor.text).toBe(">abc<");
  });

  it("offers offline edits to a new load once the old one was evicted", async () => {
    const authority = new Authority("abc");
    const a = open(authority, "a");

    authority.disconnect(a.session);
    a.editor.type({ from: 0, insert: "offline " });
    await a.network.next("push").drop();
    authority.evict();

    authority.connect(a.session);
    expect(a.session.getState().status).toBe("recovering");
    a.editor.type({ from: a.editor.text.length, insert: "!" });
    await a.network.next("recover").deliver();

    expect(a.session.getState().status).toBe("open");
    await a.network.next("push").deliver();
    expect(authority.text).toBe("offline abc!");
    expect(a.editor.text).toBe("offline abc!");
    const fresh = open(authority, "b");
    expect(fresh.editor.text).toBe("offline abc!");
  });

  it("holds offline edits in a conflict when the file changed after eviction", async () => {
    const authority = new Authority("abc");
    const a = open(authority, "a");

    authority.disconnect(a.session);
    a.editor.type({ from: 0, insert: "mine " });
    await a.network.next("push").drop();
    authority.evict();
    authority.disk = "an agent rewrote this";
    authority.doc = Text.of([authority.disk]);

    authority.connect(a.session);
    await a.network.next("recover").deliver();

    expect(a.session.getState()).toMatchObject({ status: "conflict", unsent: true });
    expect(a.editor.text).toBe("mine abc");
    expect(authority.text).toBe("an agent rewrote this");

    a.session.keepMine();
    await a.network.next("push").deliver();
    expect(authority.text).toBe("mine abc");
    expect(a.session.getState()).toMatchObject({ status: "open", unsent: false });
  });

  it("takes the file's text in a conflict, dropping the edits from undo's reach", async () => {
    const authority = new Authority("abc");
    const a = open(authority, "a");

    authority.disconnect(a.session);
    a.editor.type({ from: 0, insert: "mine " });
    await a.network.next("push").drop();
    authority.evict();
    authority.disk = "theirs";
    authority.doc = Text.of(["theirs"]);
    authority.connect(a.session);
    await a.network.next("recover").deliver();

    a.session.takeTheirs();
    expect(a.editor.text).toBe("theirs");
    expect(a.session.getState()).toMatchObject({ status: "open", unsent: false });
    expect(a.network.calls).toHaveLength(0);
  });

  it("starts over from the new load when nothing was waiting to be sent", () => {
    const authority = new Authority("abc");
    const a = open(authority, "a");

    authority.disconnect(a.session);
    authority.evict();
    authority.disk = "abc, changed";
    authority.doc = Text.of([authority.disk]);
    authority.connect(a.session);

    expect(a.editor.text).toBe("abc, changed");
    expect(a.session.getState().status).toBe("open");
    expect(a.network.calls).toHaveLength(0);
  });

  it("reports a deleted file with unsaved edits, and saving recreates it", async () => {
    const authority = new Authority("abc");
    const a = open(authority, "a");

    authority.removeDisk();
    a.editor.type({ from: 3, insert: "d" });
    await a.network.next("push").deliver();
    expect(a.session.getState()).toMatchObject({ missing: true, unsaved: true, unsent: false });

    const saving = a.session.save();
    await a.network.next("save").deliver();
    await saving;
    expect(authority.disk).toBe("abcd");
    expect(a.session.getState()).toMatchObject({ missing: false, unsaved: false });
  });

  it("closes a deleted file's document when its edits are discarded", async () => {
    const authority = new Authority("abc");
    const a = open(authority, "a");

    authority.removeDisk();
    a.editor.type({ from: 3, insert: "d" });
    await a.network.next("push").deliver();
    const discarding = a.session.discard();
    await a.network.next("discard").deliver();
    await discarding;

    expect(a.session.getState().status).toBe("closed");
  });

  it("tells a language-server request which version it is at and what it hasn't sent", async () => {
    const authority = new Authority("abc");
    const a = open(authority, "a");
    authority.writeDisk("abcd");
    a.editor.type({ from: 0, insert: "x" });
    const state = a.session.lspState();
    expect(state).toMatchObject({ loadId: "load-1", version: 1, clientId: "a" });
    expect(
      state?.unconfirmed.map((json) =>
        ChangeSet.fromJSON(json)
          .apply(Text.of(["abcd"]))
          .toString(),
      ),
    ).toEqual(["xabcd"]);
    await a.network.next("push").deliver();
    expect(a.session.lspState()).toMatchObject({ version: 2, unconfirmed: [] });
  });

  it("brings positions from an environment version forward to the editor's text", async () => {
    const authority = new Authority("one\ntwo");
    const a = open(authority, "a");
    authority.writeDisk("zero\none\ntwo");
    a.editor.type({ from: 0, insert: "// mine\n" });
    const at = a.session.changesSince(0);
    if (typeof at === "string") throw new Error(at);
    expect(at.text.toString()).toBe("one\ntwo");
    // "two" at the old start of line 2 is now three lines further down.
    expect(at.changes.mapPos(4)).toBe(a.editor.text.indexOf("two"));
    expect(a.session.changesSince(5)).toBe("behind");
    let advanced = 0;
    a.session.onVersion(() => advanced++);
    await a.network.next("push").deliver();
    expect(advanced).toBe(1);
    expect(a.session.changesSince(2)).toMatchObject({ text: Text.of(a.editor.text.split("\n")) });
  });

  it("never pushes from a read-only connection", () => {
    const authority = new Authority("abc");
    const a = open(authority, "a", false);
    authority.writeDisk("abcd");

    expect(a.editor.text).toBe("abcd");
    expect(a.network.calls).toHaveLength(0);
  });
});
