import {
  collab,
  getClientID,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import {
  ChangeSet,
  type EditorState,
  type Extension,
  Text,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type {
  DocumentErrorReason,
  DocumentPushInput,
  DocumentPushResult,
  DocumentRecoverInput,
  DocumentRecoverResult,
  DocumentSaveResult,
  DocumentStreamItem,
  DocumentSubscribeInput,
  DocumentTarget,
  DocumentUpdate,
} from "@t3tools/contracts";

/**
 * Astrolabe: one editor's side of an open repository file, speaking `@codemirror/collab` to the
 * environment's `Documents` service. The environment holds the text, orders every edit and saves
 * it; the editor keeps typing while its edits are on their way, and the session confirms them as
 * the environment's stream reports them back.
 */

/** Why a document call or stream failed; `unavailable` is a lost or missing connection. */
export interface DocumentFailure {
  readonly reason: DocumentErrorReason | "unavailable" | "other";
  readonly message: string;
}

export type DocumentCallResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: DocumentFailure };

type Loaded<A> = Omit<A, keyof DocumentTarget>;

/** The environment's document calls, bound to one file. */
export interface DocumentChannel {
  readonly push: (
    input: Loaded<DocumentPushInput>,
  ) => Promise<DocumentCallResult<DocumentPushResult>>;
  readonly save: (input: {
    readonly loadId: string;
  }) => Promise<DocumentCallResult<DocumentSaveResult>>;
  readonly recover: (
    input: Loaded<DocumentRecoverInput>,
  ) => Promise<DocumentCallResult<DocumentRecoverResult>>;
  readonly discard: (input: { readonly loadId: string }) => Promise<DocumentCallResult<void>>;
}

/** What the session needs of the editor: an `EditorView` fits. */
export interface DocumentEditor {
  readonly state: EditorState;
  readonly dispatch: (transaction: Transaction | TransactionSpec) => void;
}

export interface DocumentSessionState {
  /**
   * `opening` until the first text arrives. `recovering` while edits made against a load the
   * environment dropped are offered to its new load; `conflict` when it refused them, because the
   * file changed meanwhile: the editor keeps your text until you keep it or take the file's.
   * `closed` once discarded; `failed` when the file cannot be opened.
   */
  readonly status: "opening" | "open" | "recovering" | "conflict" | "closed" | "failed";
  readonly failure: DocumentFailure | null;
  /** The file is gone from disk. */
  readonly missing: boolean;
  /** Edits the environment does not have yet, lost if the editor closes now. */
  readonly unsent: boolean;
  /** Edits not on disk yet: unsent ones, or ones the environment has not saved. */
  readonly unsaved: boolean;
}

const OPENING: DocumentSessionState = {
  status: "opening",
  failure: null,
  missing: false,
  unsent: false,
  unsaved: false,
};

// Updates that reset the editor to the environment's text come from no editor.
const RESET_CLIENT_ID = "reset";

const fromWire = (updates: ReadonlyArray<DocumentUpdate>) =>
  updates.map((update) => ({
    clientID: update.clientId,
    changes: ChangeSet.fromJSON(update.changes),
  }));

/** One replacement turning `from` into `to`: what they share at each end stays. */
export function replacingChanges(from: string, to: string): ChangeSet {
  let start = 0;
  const shorter = Math.min(from.length, to.length);
  while (start < shorter && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < shorter - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  ) {
    end++;
  }
  return ChangeSet.of(
    start === from.length && start === to.length
      ? []
      : [{ from: start, to: from.length - end, insert: to.slice(start, to.length - end) }],
    from.length,
  );
}

/** The environment's copy as this session last heard it. */
interface Remote {
  readonly loadId: string;
  version: number;
  text: Text;
}

interface Recovery {
  readonly loadId: string;
  /** How many of the editor's unconfirmed updates `text` holds. */
  readonly folded: number;
  readonly text: string;
  /** The version after the environment took the recovered edits, once it has. */
  acceptedAt: number | null;
}

export class DocumentSession {
  readonly clientId: string;
  private readonly target: DocumentTarget;
  private readonly channel: DocumentChannel;
  private readonly canWrite: () => boolean;
  private editor: DocumentEditor | null = null;
  /** The first load's text, for building the editor. */
  private opened: { readonly text: string; readonly version: number } | null = null;
  /** Items that arrived before the editor was attached. */
  private waiting: Array<DocumentStreamItem> = [];
  /** The environment's load and its text at the editor's synced version. */
  private remote: Remote | null = null;
  /** The environment's version minus the editor's synced version. */
  private offset = 0;
  private savedVersion = 0;
  private missing = false;
  private status: DocumentSessionState["status"] = "opening";
  private failure: DocumentFailure | null = null;
  private pushing = false;
  /** Pushes wait until the stream has reported the last accepted push. */
  private awaitVersion = 0;
  private recovery: Recovery | null = null;
  private snapshot: DocumentSessionState = OPENING;
  private readonly listeners = new Set<() => void>();

  constructor(options: {
    readonly target: DocumentTarget;
    readonly clientId: string;
    readonly channel: DocumentChannel;
    readonly canWrite: () => boolean;
  }) {
    this.target = options.target;
    this.clientId = options.clientId;
    this.channel = options.channel;
    this.canWrite = options.canWrite;
  }

  // ---- For the view ----

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): DocumentSessionState => this.snapshot;

  /** The text and collab extension to build the editor from, once the first load arrived. */
  initialState(): { readonly text: string; readonly extension: Extension } | null {
    if (this.opened === null) return null;
    return {
      text: this.opened.text,
      extension: collab({ startVersion: this.opened.version, clientID: this.clientId }),
    };
  }

  /** The text as the editor has it now, or as it first arrived. */
  text(): string | null {
    return this.editor?.state.doc.toString() ?? this.opened?.text ?? null;
  }

  /** Binds the editor built from `initialState`, and catches it up. */
  attach(editor: DocumentEditor): void {
    if (getClientID(editor.state) !== this.clientId) throw new Error("Not this session's editor");
    this.editor = editor;
    const waiting = this.waiting;
    this.waiting = [];
    for (const item of waiting) this.receive(item);
    this.flush();
  }

  detach(): void {
    this.editor = null;
  }

  /** After each editor transaction: sends new edits and reports whether any are unsent. */
  changed(): void {
    this.flush();
    this.publish();
  }

  /** What to subscribe with: after a reconnect, where this session left off. */
  subscribeInput(): DocumentSubscribeInput {
    const remote = this.recovery === null ? this.remote : null;
    if (remote === null || this.editor === null) return this.target;
    return { ...this.target, resume: { loadId: remote.loadId, version: remote.version } };
  }

  // ---- From the environment ----

  receive(item: DocumentStreamItem): void {
    if (this.status === "closed") return;
    if (this.opened === null) {
      if (item.type !== "snapshot") return;
      this.opened = { text: item.text, version: item.version };
      this.remote = {
        loadId: item.loadId,
        version: item.version,
        text: Text.of(item.text.split("\n")),
      };
      this.disk(item);
      this.status = "open";
      return this.publish();
    }
    if (this.editor === null) {
      this.waiting.push(item);
      return;
    }
    switch (item.type) {
      case "snapshot":
        this.newLoad(item);
        break;
      case "resumed":
        this.disk(item);
        this.updates(item.version, item.updates);
        break;
      case "updates":
        this.updates(item.version, item.updates);
        break;
      case "disk":
        this.disk(item);
        break;
    }
    this.flush();
    this.publish();
  }

  /**
   * The stream failed: the file cannot be opened, or is gone. Once the editor has text it stays,
   * so nothing typed is lost; the failure is shown beside it.
   */
  failed(failure: DocumentFailure): void {
    if (this.status === "closed") return;
    if (this.opened === null) this.status = "failed";
    else if (failure.reason === "not-found") this.missing = true;
    this.failure = failure;
    this.publish();
  }

  // ---- Actions ----

  /** Writes the file now, recreating it if it was deleted. */
  async save(): Promise<DocumentCallResult<DocumentSaveResult> | null> {
    const remote = this.remote;
    if (remote === null || this.status !== "open") return null;
    const result = await this.channel.save({ loadId: remote.loadId });
    if (!result.ok) this.report(result.error);
    return result;
  }

  /** Drops the edits that are not on disk; a deleted file's document closes. */
  async discard(): Promise<DocumentCallResult<void> | null> {
    const remote = this.remote;
    if (remote === null || this.status !== "open") return null;
    const result = await this.channel.discard({ loadId: remote.loadId });
    if (!result.ok) this.report(result.error);
    else if (this.missing) {
      this.status = "closed";
      this.publish();
    }
    return result;
  }

  /** In a conflict: sends the editor's text over the file's. */
  keepMine(): void {
    const editor = this.editor;
    if (this.status !== "conflict" || editor === null) return;
    const mine = editor.state.doc.toString();
    this.resetToRemote(editor);
    const current = editor.state.doc.toString();
    if (current !== mine) {
      editor.dispatch({
        changes: replacingChanges(current, mine),
        annotations: Transaction.addToHistory.of(false),
      });
    }
    this.flush();
    this.publish();
  }

  /** In a conflict: drops the editor's edits for the file's text. */
  takeTheirs(): void {
    const editor = this.editor;
    if (this.status !== "conflict" || editor === null) return;
    this.resetToRemote(editor);
    this.publish();
  }

  // ---- Internals ----

  private disk(item: { readonly savedVersion: number; readonly missing: boolean }) {
    this.savedVersion = item.savedVersion;
    this.missing = item.missing;
  }

  private report(failure: DocumentFailure) {
    this.failure = failure;
    this.publish();
  }

  /** Accepted updates starting at the environment's `version`; ones already seen are skipped. */
  private updates(version: number, updates: ReadonlyArray<DocumentUpdate>) {
    const editor = this.editor;
    const remote = this.remote;
    if (editor === null || remote === null) return;
    if (version > remote.version) {
      this.report({ reason: "other", message: "Updates arrived out of order." });
      return;
    }
    const fresh = fromWire(updates.slice(remote.version - version));
    if (fresh.length === 0) return;
    for (const update of fresh) remote.text = update.changes.apply(remote.text);
    remote.version += fresh.length;
    if (this.status === "open") {
      editor.dispatch(receiveUpdates(editor.state, fresh));
    } else if (this.status === "recovering") {
      this.finishRecovery();
    }
  }

  private newLoad(item: Extract<DocumentStreamItem, { type: "snapshot" }>) {
    const editor = this.editor;
    if (editor === null) return;
    const previous = this.remote;
    this.remote = {
      loadId: item.loadId,
      version: item.version,
      text: Text.of(item.text.split("\n")),
    };
    this.disk(item);
    this.awaitVersion = 0;
    this.failure = null;
    if (this.status === "recovering" || this.status === "conflict") {
      // A reconnect mid-recovery: the attempt in flight stands against this load if it is the same.
      if (this.recovery?.loadId === item.loadId) this.finishRecovery();
      else this.toConflict(null);
      return;
    }
    const unconfirmed = sendableUpdates(editor.state);
    if (unconfirmed.length === 0 || previous === null) {
      this.resetToRemote(editor);
      return;
    }
    this.status = "recovering";
    const recovery: Recovery = {
      loadId: item.loadId,
      folded: unconfirmed.length,
      text: editor.state.doc.toString(),
      acceptedAt: null,
    };
    this.recovery = recovery;
    void this.channel
      .recover({
        loadId: item.loadId,
        clientId: this.clientId,
        baseText: previous.text.toString(),
        text: recovery.text,
      })
      .then((result) => {
        if (this.recovery !== recovery) return;
        if (!result.ok) return this.toConflict(result.error);
        if (result.value.type === "conflict") return this.toConflict(null);
        recovery.acceptedAt = result.value.version;
        this.finishRecovery();
      });
  }

  /** Once the stream has caught up past the recovered edits, the editor rejoins the load. */
  private finishRecovery() {
    const editor = this.editor;
    const remote = this.remote;
    const recovery = this.recovery;
    if (editor === null || remote === null || recovery === null) return;
    if (recovery.acceptedAt === null || remote.version < recovery.acceptedAt) return;
    const unconfirmed = sendableUpdates(editor.state).slice(0, recovery.folded);
    // The recovered edits are in the load now: confirm them without touching the text, then
    // move from the text they made to the environment's, rebasing what was typed since.
    editor.dispatch(
      receiveUpdates(
        editor.state,
        unconfirmed.map((update) => ({ clientID: this.clientId, changes: update.changes })),
      ),
    );
    editor.dispatch(
      receiveUpdates(editor.state, [
        {
          clientID: RESET_CLIENT_ID,
          changes: replacingChanges(recovery.text, remote.text.toString()),
        },
      ]),
    );
    this.offset = remote.version - getSyncedVersion(editor.state);
    this.recovery = null;
    this.status = "open";
    this.flush();
    this.publish();
  }

  private toConflict(failure: DocumentFailure | null) {
    this.recovery = null;
    this.status = "conflict";
    this.failure = failure;
    this.publish();
  }

  /** Makes the editor's text the environment's, dropping its unconfirmed edits. */
  private resetToRemote(editor: DocumentEditor) {
    const remote = this.remote;
    if (remote === null) return;
    const unconfirmed = sendableUpdates(editor.state);
    if (unconfirmed.length > 0) {
      editor.dispatch(
        receiveUpdates(
          editor.state,
          unconfirmed.map((update) => ({ clientID: this.clientId, changes: update.changes })),
        ),
      );
    }
    editor.dispatch(
      receiveUpdates(editor.state, [
        {
          clientID: RESET_CLIENT_ID,
          changes: replacingChanges(editor.state.doc.toString(), remote.text.toString()),
        },
      ]),
    );
    this.offset = remote.version - getSyncedVersion(editor.state);
    this.recovery = null;
    this.status = "open";
    this.failure = null;
  }

  private flush() {
    const editor = this.editor;
    const remote = this.remote;
    if (editor === null || remote === null || this.status !== "open") return;
    if (this.pushing || remote.version < this.awaitVersion || !this.canWrite()) return;
    const unconfirmed = sendableUpdates(editor.state);
    if (unconfirmed.length === 0) return;
    this.pushing = true;
    const loadId = remote.loadId;
    void this.channel
      .push({
        loadId,
        version: getSyncedVersion(editor.state) + this.offset,
        updates: unconfirmed.map((update) => ({
          clientId: update.clientID,
          changes: update.changes.toJSON(),
        })),
      })
      .then((result) => {
        this.pushing = false;
        if (this.remote?.loadId !== loadId) return;
        if (result.ok) {
          this.awaitVersion = result.value.version;
          this.failure = null;
          this.flush();
        } else if (result.error.reason !== "unavailable") {
          // The next edit tries again; a connection that comes back resumes and pushes again.
          this.failure = result.error;
        }
        this.publish();
      });
  }

  private publish() {
    const editor = this.editor;
    const unsent =
      this.status === "recovering" ||
      this.status === "conflict" ||
      (editor !== null && sendableUpdates(editor.state).length > 0);
    const version = this.remote?.version ?? 0;
    const next: DocumentSessionState = {
      status: this.status,
      failure: this.failure,
      missing: this.missing,
      unsent,
      unsaved: unsent || this.savedVersion < version,
    };
    const previous = this.snapshot;
    if (
      previous.status === next.status &&
      previous.failure === next.failure &&
      previous.missing === next.missing &&
      previous.unsent === next.unsent &&
      previous.unsaved === next.unsaved
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
