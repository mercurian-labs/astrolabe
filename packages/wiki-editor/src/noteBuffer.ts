import {
  declareAgent,
  endAgentTurn,
  parkAgentCursor,
  type AgentPresence,
} from "@mercurian/editor/collab/agent-awareness";
import { applyFileText, fileTextTarget } from "@mercurian/editor/bridge/file-text";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";

import { resolveIncomingNote } from "./incoming";

/**
 * One loaded version of a note: the Yjs document the editor binds to, and the agent peer that
 * turns the change request's new versions into attributed edits on it.
 */
export interface WikiNoteSession {
  readonly doc: Y.Doc;
  readonly text: Y.Text;
  readonly awareness: Awareness;
}

interface AgentPeer {
  readonly doc: Y.Doc;
  readonly text: Y.Text;
  readonly awareness: Awareness;
  /** The presence last declared, so a repeat declaration is skipped. */
  presence: AgentPresence | null;
}

interface Loaded {
  readonly session: WikiNoteSession;
  readonly agent: AgentPeer;
  readonly dispose: () => void;
}

export interface WikiNoteBufferSnapshot {
  /** Null until the note's first read arrives. */
  readonly session: WikiNoteSession | null;
  /** The buffer holds the person's edits that are not saved yet. */
  readonly dirty: boolean;
  /** The note changed underneath unsaved edits; the edits stay until the person chooses. */
  readonly changedUnderneath: boolean;
}

/** Marks updates relayed between the two peers, so neither sends them back. */
const RELAYED = Symbol("wiki-note-relay");

/**
 * The view's document, with the agent peer synced to it: text both ways (the agent's writes
 * land in the view, and the person's typing reaches the agent's copy so a write is mapped onto
 * it), awareness from the agent only (its presence and cursor).
 */
function load(source: string): Loaded {
  const doc = new Y.Doc();
  const text = doc.getText("note");
  text.insert(0, source);
  const awareness = new Awareness(doc);
  const agentDoc = new Y.Doc();
  const agentAwareness = new Awareness(agentDoc);
  Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(doc), RELAYED);
  const toAgent = (update: Uint8Array, origin: unknown) => {
    if (origin !== RELAYED) Y.applyUpdate(agentDoc, update, RELAYED);
  };
  const toView = (update: Uint8Array, origin: unknown) => {
    if (origin !== RELAYED) Y.applyUpdate(doc, update, RELAYED);
  };
  const presence = ({ added, updated, removed }: Record<string, number[]>) => {
    const changed = [...(added ?? []), ...(updated ?? []), ...(removed ?? [])].filter(
      (client) => client === agentAwareness.clientID,
    );
    if (changed.length > 0) {
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(agentAwareness, changed), RELAYED);
    }
  };
  doc.on("update", toAgent);
  agentDoc.on("update", toView);
  agentAwareness.on("update", presence);
  return {
    session: { doc, text, awareness },
    agent: {
      doc: agentDoc,
      text: agentDoc.getText("note"),
      awareness: agentAwareness,
      presence: null,
    },
    dispose: () => {
      doc.off("update", toAgent);
      agentDoc.off("update", toView);
      agentAwareness.off("update", presence);
      // Awareness runs a timer of its own until destroyed.
      agentAwareness.destroy();
      awareness.destroy();
      agentDoc.destroy();
      doc.destroy();
    },
  };
}

/** Who wrote a version that lands live: the amendment's actor, in its turn. */
export type WikiNoteAuthor = AgentPresence;

/**
 * The editing buffer of the note on screen; reads arrive through `receive`. A read of a change
 * request's head carrying someone else's amendment lands live: the agent peer applies the diff from
 * the version it last wrote onto the buffer, attributed, keeping unsaved edits. Other reads replace
 * the buffer only with no unsaved edits; a reload starts a new session, which remounts the editor.
 */
export class WikiNoteBuffer {
  private loaded: Loaded | null = null;
  /** The text the person's edits are measured from: the last version read, written, or saved. */
  private baseline = "";
  /** The file text after the agent peer's last write, or as loaded: its next write's diff base. */
  private agentBase = "";
  private pending: string | null = null;
  private snapshot: WikiNoteBufferSnapshot = {
    session: null,
    dirty: false,
    changedUnderneath: false,
  };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.snapshot;

  /** The buffer's text now. */
  current(): string {
    return this.loaded?.session.text.toString() ?? this.baseline;
  }

  /**
   * A fresh read of the note. With `author`, a version that differs from the agent peer's last
   * write is that author's amendment and lands live; without, it reloads or waits.
   */
  receive(incoming: string, author: WikiNoteAuthor | null = null) {
    if (this.loaded === null) {
      this.reset(incoming);
      return;
    }
    if (author !== null) {
      this.applyLive(incoming, author);
      return;
    }
    switch (resolveIncomingNote({ baseline: this.baseline, buffer: this.current(), incoming })) {
      case "keep":
        this.pending = null;
        this.publish();
        return;
      case "adopt":
        this.baseline = incoming;
        this.agentBase = incoming;
        this.pending = null;
        this.publish();
        return;
      case "reload":
        this.reset(incoming);
        return;
      case "conflict":
        this.pending = incoming;
        this.publish();
        return;
    }
  }

  /** The author's turn ended: its changes settle (they stay until reviewed). */
  endTurn() {
    const agent = this.loaded?.agent;
    if (!agent || agent.presence === null) return;
    endAgentTurn(agent.awareness);
    agent.presence = null;
  }

  /** Drops the edits for the version that changed underneath them. */
  loadChanged() {
    if (this.pending !== null) this.reset(this.pending);
  }

  /** Drops the edits for the text the buffer was loaded from. */
  discard() {
    this.reset(this.pending ?? this.baseline);
  }

  /** `text` is now saved: it is what the next read should bring back. */
  markSaved(text: string) {
    this.baseline = text;
    this.agentBase = text;
    if (this.pending === text) this.pending = null;
    this.publish();
  }

  /** Destroys the loaded session; the next read loads the note again. */
  release() {
    this.loaded?.dispose();
    this.loaded = null;
    this.baseline = "";
    this.agentBase = "";
    this.pending = null;
    this.publish();
  }

  private applyLive(incoming: string, author: WikiNoteAuthor) {
    const loaded = this.loaded;
    if (loaded === null || incoming === this.agentBase) return;
    const { agent } = loaded;
    if (
      agent.presence === null ||
      agent.presence.turnId !== author.turnId ||
      agent.presence.name !== author.name
    ) {
      // Declared before the write, so the write is attributed (see `declareAgent`).
      declareAgent(agent.awareness, author);
      agent.presence = author;
    }
    const target = fileTextTarget(agent.text, this.agentBase, incoming);
    if (target !== null) parkAgentCursor(agent.awareness, agent.text, target);
    const end = applyFileText(agent.text, this.agentBase, incoming, { log: author });
    if (end !== null) parkAgentCursor(agent.awareness, agent.text, end);
    this.agentBase = incoming;
    // The change request now holds `incoming`; whatever else the buffer holds is the person's.
    this.baseline = incoming;
    this.pending = null;
    this.publish();
  }

  private reset(source: string) {
    this.loaded?.dispose();
    this.baseline = source;
    this.agentBase = source;
    this.pending = null;
    const loaded = load(source);
    loaded.session.text.observe(() => this.publish());
    this.loaded = loaded;
    this.publish();
  }

  private publish() {
    const next: WikiNoteBufferSnapshot = {
      session: this.loaded?.session ?? null,
      dirty: this.current() !== this.baseline,
      changedUnderneath: this.pending !== null,
    };
    if (
      next.session === this.snapshot.session &&
      next.dirty === this.snapshot.dirty &&
      next.changedUnderneath === this.snapshot.changedUnderneath
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
