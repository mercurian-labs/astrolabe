import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { declareAgent, parkAgentCursor, type AgentPresence } from "../collab/agentAwareness.ts";
import { applyFileText } from "./fileText.ts";

/**
 * A file on disk, mirrored into a Yjs text as an agent peer's edits. Hand `text` and
 * `awareness` to a locked `AtlasEditor`; hand every new file text to `write`. Each write
 * lands as the minimal diff from the text last written, attributed to the agent, so the
 * editor highlights what changed and parks the agent's cursor after it.
 */
export interface FileMirror {
  readonly text: Y.Text;
  readonly awareness: Awareness;
  /** The file's text now. Held until `attach`, so the editor sees it arrive rather than mount with it. */
  write(next: string): void;
  /** An editor is mounted on `text`: apply whatever was written while none was, a microtask later. */
  attach(): void;
  /** The editor is gone: hold writes again until the next one attaches. */
  detach(): void;
  destroy(): void;
}

/** A mirror of a file whose text was `initial` when the mirror was made. */
export function createFileMirror(initial: string, agent: AgentPresence): FileMirror {
  const viewDoc = new Y.Doc();
  const viewAwareness = new Awareness(viewDoc);
  const agentDoc = new Y.Doc();
  const agentAwareness = new Awareness(agentDoc);
  const agentText = agentDoc.getText("file");

  // One way only: the viewer is locked, so nothing flows back to the agent.
  agentDoc.on("update", (update: Uint8Array) => Y.applyUpdate(viewDoc, update));
  agentAwareness.on("update", ({ added, updated }: { added: number[]; updated: number[] }) => {
    const changed = [...added, ...updated];
    if (changed.length > 0) {
      applyAwarenessUpdate(viewAwareness, encodeAwarenessUpdate(agentAwareness, changed), agent);
    }
  });
  // The seed reaches the viewer before any editor observes it, so it is never highlighted.
  agentText.insert(0, initial);
  declareAgent(agentAwareness, agent);

  let flushed = initial;
  let pending: string | null = null;
  let attached = false;
  const flush = () => {
    if (pending === null) return;
    const end = applyFileText(agentText, flushed, pending);
    flushed = pending;
    pending = null;
    if (end !== null) parkAgentCursor(agentAwareness, agentText, end);
  };

  return {
    text: viewDoc.getText("file"),
    awareness: viewAwareness,
    write(next) {
      pending = next;
      if (attached) flush();
    },
    attach() {
      attached = true;
      // A microtask later, so an editor mounted and torn down at once (React's StrictMode
      // mounts effects twice) does not take the held writes with it.
      queueMicrotask(() => {
        if (attached) flush();
      });
    },
    detach() {
      attached = false;
    },
    destroy() {
      agentAwareness.destroy();
      viewAwareness.destroy();
      agentDoc.destroy();
      viewDoc.destroy();
    },
  };
}
