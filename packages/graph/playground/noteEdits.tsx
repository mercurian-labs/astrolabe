/**
 * The note the agent is changing, shown as it changes: every file write in the
 * workspace (see `workspaceFiles.ts`) lands in a locked Atlas Editor as the
 * agent's edit, highlighted, with its cursor parked after it. The person
 * watches and cannot type; the file on disk is the only source.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { AtlasEditor } from "@mercurian/editor/editor";
import { createFileMirror, type FileMirror } from "@mercurian/editor/bridge/file-mirror";
import "@mercurian/editor/markdown/katex.css";
import "@mercurian/editor/markdown/theme.css";

import type { WorkspaceEvent } from "./workspaceFiles.ts";

/** The graph's rust accent, in the six-digit hex the editor's agent colours require. */
const AGENT_COLOR = "#b24a26";

interface ActiveNote {
  readonly note: string;
  readonly mirror: FileMirror;
}

/** The workspace's change stream, as the note to show. One per page. */
export class NoteEdits {
  readonly #mirrors = new Map<string, FileMirror>();
  readonly #listeners = new Set<() => void>();
  #active: ActiveNote | null = null;
  #turn = "turn";

  /** Listens to the workspace; returns the way to stop. */
  connect(): () => void {
    const source = new EventSource("/__workspace/events");
    source.addEventListener("message", (message: MessageEvent<string>) => {
      this.#receive(JSON.parse(message.data) as WorkspaceEvent);
    });
    return () => source.close();
  }

  /** A new turn: what the last one wrote stops being highlighted, and its popup closes. */
  newTurn(turn: string): void {
    this.#turn = turn;
    for (const note of this.#mirrors.keys()) this.#retire(note);
    this.#show(null);
  }

  dismiss(): void {
    this.#show(null);
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly snapshot = () => this.#active;

  #receive(event: WorkspaceEvent): void {
    if ("reset" in event) {
      // The playground moved the thread: the file was set, not edited.
      this.#retire(event.note);
      if (this.#active?.note === event.note) this.#show(null);
      return;
    }
    let mirror = this.#mirrors.get(event.note);
    if (mirror === undefined) {
      mirror = createFileMirror(event.previous, {
        name: "Agent",
        color: AGENT_COLOR,
        turnId: this.#turn,
      });
      this.#mirrors.set(event.note, mirror);
    }
    // Held by the mirror until an editor is mounted on it, so the edit is seen arriving.
    mirror.write(event.text);
    if (this.#active?.mirror !== mirror) this.#show({ note: event.note, mirror });
  }

  #retire(note: string): void {
    const mirror = this.#mirrors.get(note);
    if (mirror === undefined) return;
    this.#mirrors.delete(note);
    // After React has unmounted any editor on it.
    setTimeout(() => mirror.destroy(), 0);
  }

  #show(active: ActiveNote | null): void {
    this.#active = active;
    for (const listener of this.#listeners) listener();
  }
}

function MirrorEditor({ mirror }: { mirror: FileMirror }) {
  // The editor's own effect runs first, so the view exists when held writes land.
  useEffect(() => {
    mirror.attach();
    return () => mirror.detach();
  }, [mirror]);
  return (
    <AtlasEditor
      locked
      className="note-edit-editor"
      text={mirror.text}
      awareness={mirror.awareness}
    />
  );
}

export function NoteEditPopup({ edits }: { edits: NoteEdits }) {
  const active = useSyncExternalStore(edits.subscribe, edits.snapshot);
  if (active === null) return null;
  return (
    <section className="note-edit" aria-label={`Agent editing ${active.note}`}>
      <header className="note-edit-bar">
        <span className="note-edit-dot" />
        <span className="note-edit-name">{active.note}.md</span>
        <span className="note-edit-state">agent writing · read only</span>
        <button type="button" aria-label="Close" onClick={() => edits.dismiss()}>
          ×
        </button>
      </header>
      <MirrorEditor key={active.note} mirror={active.mirror} />
    </section>
  );
}

/** A page's `NoteEdits`, listening while mounted. */
export function useNoteEdits(): NoteEdits {
  const [edits] = useState(() => new NoteEdits());
  useEffect(() => edits.connect(), [edits]);
  return edits;
}
