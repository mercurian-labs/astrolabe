import { StrictMode, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { AtlasEditor } from "../src/editor.tsx";
import { declareAgent, endAgentTurn, parkAgentCursor } from "../src/collab/agentAwareness.ts";
import {
  agentChangeBar,
  followAgentChanges,
  revealAgentChanges,
} from "../src/collab/agentChanges.ts";
import { applyFileText, fileTextTarget } from "../src/bridge/fileText.ts";
import "../src/markdown/katex.css";
import "../src/markdown/theme.css";
import "./styles.css";

const SEED = `---
title: Atlas editor
tags: [demo, editor]
---

# Atlas editor

This note is a **live preview**: put the cursor on a line to see its Markdown, move away and the markers hide. It is *Yjs-backed*, so another peer can edit it too.

## Inline

Text can be **bold**, *italic*, ~~struck~~, ==highlighted==, or \`inline code\`. Click at the start of this line: the **far bold span** stays rendered. Escapes keep \\*literal\\* stars. Math such as $E=mc^2$ is rendered. A comment %%only in the editor%% is dimmed. Tags: #atlas and #notes/editor, but #1 is not a tag. A footnote reference[^1] and a hard break at the end of this line  
carry on here.

## Links

An [inline link](https://example.com "Example"), a [reference link][docs], a [collapsed one][], and a [shortcut]. Brackets without a definition stay literal: [word], [1], [missing]. An autolink <https://t3.codes>, an email <someone@example.com>, a bare www.example.com, and https://example.com/path. Blocked: [bad link](javascript:alert(1)).

Wikilinks: [[Project plan]], [[Project plan|the plan]], [[Project plan#Goals]]. An embed: ![[Meeting notes]].

An image ![a placeholder](https://placehold.co/240x80/png) and a linked one [![logo](https://placehold.co/80x40/png)](https://example.com).

[docs]: https://example.com/docs
[collapsed one]: https://example.com/collapsed
[shortcut]: https://example.com/shortcut
[^1]: Footnote definitions keep their label.

## Lists

- A bullet item
- Another bullet
  - Nested under it
* A star marker
+ A plus marker
1. Ordered items keep their numbers
2. As typed
- [ ] An open task
- [x] A done task
- [-] A cancelled task

## Blocks

> Agents write through the file bridge, as a minimal diff against the last flushed text.

> [!note] Callout title
> Callouts carry an icon and a colour.

> [!warning]- Folded callout
> This body stays folded until the caret enters it.

\`\`\`ts
const greeting = "hello";
\`\`\`

---

| Column | Other |
| ------ | ----- |
| cell | **bold** cell |

$$
\\int_0^1 x\\,dx
$$

<div>HTML stays source.</div>

Inline <span>HTML</span> stays source too.

Setext heading
--------------

## What to try

- Type \`**bold**\` on a new line, then move the cursor off it.
- Press **Run turn** and keep typing: the agent's writes land around your caret.
- Click a struck-through ghost to restore or dismiss what the agent deleted.

## Agent notes

`;

const AGENT_NOTES = [
  "- The bridge applies one Yjs transaction per file write.\n",
  "- Attribution comes from the Yjs client id of each inserted item.\n",
  "- Each write is one entry in the change log, with its deletions as ghosts.\n",
  "- The cursor parks at the end of the agent's last insertion.\n",
];

/** Swaps `a` for `b` in `file`, or back again, so the script can run turn after turn. */
function swap(file: string, a: string, b: string) {
  if (file.includes(a)) return file.replace(a, b);
  if (file.includes(b)) return file.replace(b, a);
  return file;
}

const QUOTE_BEFORE =
  "> Agents write through the file bridge, as a minimal diff against the last flushed text.";
const QUOTE_AFTER = "> Agents write files; the bridge turns each write into one Yjs transaction.";
const TRY_BEFORE = `- Type \`**bold**\` on a new line, then move the cursor off it.
- Press **Run turn** and keep typing: the agent's writes land around your caret.
- Click a struck-through ghost to restore or dismiss what the agent deleted.
`;
const TRY_AFTER = `Two peers share this note. Start a turn, write too, then review from the bar below: \`Next\` steps through each change; accept it, or put old text back.
`;
const PLUS_ITEM = "+ A plus marker\n";

/** One agent turn: four tool calls, each a file write. */
const SCRIPT: readonly ((file: string, turn: number) => string)[] = [
  (file, turn) => file + (AGENT_NOTES[(turn - 1) % AGENT_NOTES.length] ?? ""),
  (file) => swap(file, QUOTE_BEFORE, QUOTE_AFTER),
  (file) => swap(file, TRY_BEFORE, TRY_AFTER),
  (file) =>
    file.includes(PLUS_ITEM)
      ? file.replace(PLUS_ITEM, "")
      : file.replace("1. Ordered items", `${PLUS_ITEM}1. Ordered items`),
];

const TOOL_CALL_GAP_MS = 1200;
// How long the agent's cursor sits where it is about to write before the write lands: long
// enough for Follow agent's smooth scroll, its settle check at 450 ms, and one correcting
// scroll (Chromium's smooth scrolls measured 350 to 650 ms here), so the write lands after
// the view has stopped.
const WRITE_BEAT_MS = 1100;
const TURN_END_PAUSE_MS = 1500;

const REMOTE = Symbol("remote");
const USER_COLOR = "#0ea5e9";
const AGENT_COLOR = "#d946ef";

/** Relays document and awareness updates between two peers, as a network provider would. */
function connectPeers(a: { doc: Y.Doc; awareness: Awareness }, b: typeof a) {
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    from.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(to.doc, update, REMOTE);
    });
    from.awareness.on(
      "update",
      (change: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin === REMOTE) return;
        const own = [...change.added, ...change.updated, ...change.removed].filter(
          (client) => client === from.awareness.clientID,
        );
        if (own.length > 0) {
          applyAwarenessUpdate(to.awareness, encodeAwarenessUpdate(from.awareness, own), REMOTE);
        }
      },
    );
  }
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), REMOTE);
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc), REMOTE);
}

/** What the header shows: the turn, whether it runs, and the simulated file on disk. */
interface TurnSnapshot {
  turn: number;
  /** Tool calls made in the current turn; null between turns. */
  step: number | null;
  /** The tool call whose write is about to land (the cursor is already there), or null. */
  writing: number | null;
  /** A turn, or all four, is playing on a timer. */
  playing: boolean;
  /** The editor scrolls to each agent write as it lands. */
  following: boolean;
  /** Each agent write is drawn in over a moment instead of appearing at once. */
  revealing: boolean;
  file: string;
}

function createSession() {
  const userDoc = new Y.Doc();
  const user = { doc: userDoc, awareness: new Awareness(userDoc) };
  const agentDoc = new Y.Doc();
  const agent = { doc: agentDoc, awareness: new Awareness(agentDoc) };

  const text = user.doc.getText("note");
  text.insert(0, SEED);
  connectPeers(user, agent);
  user.awareness.setLocalStateField("user", { name: "You", color: USER_COLOR });

  const agentText = agent.doc.getText("note");
  // The agent writes files, not Yjs operations: `flushed` is the file on disk, which the
  // agent's writes change and the user's edits reach only when the turn ends.
  let flushed = agentText.toString();
  let snapshot: TurnSnapshot = {
    turn: 0,
    step: null,
    writing: null,
    playing: false,
    following: false,
    revealing: true,
    file: flushed,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<TurnSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };

  // Each turn has a fresh id; the presence and every logged write carry it.
  const author = (turn = snapshot.turn) => ({
    turnId: `turn-${turn}`,
    name: `Agent · turn ${turn}`,
    color: AGENT_COLOR,
  });

  // Between turns nothing runs, so the file already holds the user's edits: the new turn
  // starts from the buffer as it stands.
  const startTurn = () => {
    const turn = snapshot.turn + 1;
    flushed = agentText.toString();
    declareAgent(agent.awareness, author(turn));
    publish({ turn, step: 0, file: flushed });
  };

  // The end of the turn: the presence drops its turn id, which settles the turn's changes,
  // and the buffer (the user's edits included) is flushed to the file.
  const endTurn = () => {
    endAgentTurn(agent.awareness);
    flushed = agentText.toString();
    publish({ step: null, file: flushed });
  };

  /**
   * Makes the next tool call, starting a turn first when none is running, in two beats: the
   * agent's cursor moves to where the write will make its first edit, then the write lands
   * and the cursor parks at its end. A following editor scrolls on the first beat, so the
   * write lands in view. Calls `landed` once the write is in.
   */
  const step = (landed?: () => void) => {
    if (snapshot.step === null) startTurn();
    const index = snapshot.step ?? 0;
    const call = SCRIPT[index];
    if (!call) return;
    const next = call(flushed, snapshot.turn);
    const land = () => {
      timer = null;
      const end = applyFileText(agentText, flushed, next, { log: author() });
      flushed = next;
      if (end !== null) parkAgentCursor(agent.awareness, agentText, end);
      publish({ step: index + 1, writing: null, file: flushed });
      if (index + 1 === SCRIPT.length) endTurn();
      landed?.();
    };
    const target = fileTextTarget(agentText, flushed, next);
    if (target === null) {
      land();
      return;
    }
    parkAgentCursor(agent.awareness, agentText, target);
    publish({ writing: index + 1 });
    timer = setTimeout(land, WRITE_BEAT_MS);
  };

  /**
   * Plays `turns` turns, a tool call at a time: the rest of the current turn first (it
   * counts as one), then new ones, with a pause at each turn's end so the settling shows.
   */
  const play = (turns: number) => {
    if (snapshot.playing) return;
    publish({ playing: true });
    let left = turns;
    const tick = () => {
      timer = null;
      step(() => {
        if (snapshot.step !== null) {
          timer = setTimeout(tick, TOOL_CALL_GAP_MS);
        } else if ((left -= 1) > 0) {
          timer = setTimeout(tick, TURN_END_PAUSE_MS);
        } else {
          publish({ playing: false });
        }
      });
    };
    tick();
  };

  /** Plays the rest of the turn (a whole one when none is running). */
  const runTurn = () => play(1);

  /** Plays the script's four distinct turns (its notes cycle every four) back to back. */
  const playAll = () => play(AGENT_NOTES.length);

  const stepOnce = () => {
    if (!snapshot.playing && snapshot.writing === null) step();
  };

  return {
    text,
    awareness: user.awareness,
    runTurn,
    playAll,
    step: stepOnce,
    toggleFollowing: () => publish({ following: !snapshot.following }),
    isFollowing: () => snapshot.following,
    toggleRevealing: () => publish({ revealing: !snapshot.revealing }),
    isRevealing: () => snapshot.revealing,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) clearTimeout(timer);
      };
    },
    snapshot: () => snapshot,
  };
}

/**
 * The window space the playground's chrome covers, measured when following needs it: the
 * sticky header at the top, and the change bar pinned to the editor's bottom.
 */
function chromeInsets() {
  const header = document.querySelector(".playground-bar")?.getBoundingClientRect();
  const bar = document
    .querySelector(".playground-editor .cm-panels-bottom")
    ?.getBoundingClientRect();
  return {
    top: Math.max(0, header?.bottom ?? 0),
    bottom: bar ? Math.max(0, window.innerHeight - bar.top) : 0,
  };
}

// The Vim toggle is remembered in this browser; storage can be unavailable (a private
// window, blocked site data), in which case Vim simply starts off.
const VIM_SETTING_KEY = "atlas-editor-playground:vim";

function readVimSetting() {
  try {
    return localStorage.getItem(VIM_SETTING_KEY) === "on";
  } catch {
    return false;
  }
}

function writeVimSetting(on: boolean) {
  try {
    localStorage.setItem(VIM_SETTING_KEY, on ? "on" : "off");
  } catch {
    // Not remembered; the toggle still works for this page.
  }
}

// The header's buttons keep focus, and so the caret, in the editor, so typing carries on
// while the turn plays.
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

function Playground() {
  const [session] = useState(createSession);
  const [showFile, setShowFile] = useState(false);
  const [vim, setVim] = useState(readVimSetting);
  // Stable for the session: a new array would remount the editor.
  const extensions = useMemo(
    () => [
      agentChangeBar(),
      followAgentChanges({ isOn: session.isFollowing, insets: chromeInsets }),
      revealAgentChanges({ isOn: session.isRevealing }),
    ],
    [session],
  );
  const turn = useSyncExternalStore(session.subscribe, session.snapshot);
  const status =
    turn.writing !== null
      ? `Turn ${turn.turn}: writing ${turn.writing} of ${SCRIPT.length}…`
      : turn.step === null
        ? turn.turn === 0
          ? "No turn yet"
          : `Turn ${turn.turn} ended`
        : `Turn ${turn.turn}: ${turn.step} of ${SCRIPT.length} tool calls`;
  const busy = turn.playing || turn.writing !== null;
  return (
    <main className="playground">
      <header className="playground-bar">
        <h1>Atlas editor</h1>
        <span className="playground-peer" style={{ "--peer-color": USER_COLOR } as CSSProperties}>
          You
        </span>
        <span className="playground-peer" style={{ "--peer-color": AGENT_COLOR } as CSSProperties}>
          {turn.turn === 0 ? "Agent" : `Agent · turn ${turn.turn}`}
        </span>
        <span className="playground-status">{status}</span>
        <button type="button" onMouseDown={keepFocus} onClick={session.runTurn} disabled={busy}>
          Run turn
        </button>
        <button type="button" onMouseDown={keepFocus} onClick={session.step} disabled={busy}>
          Step
        </button>
        <button type="button" onMouseDown={keepFocus} onClick={session.playAll} disabled={busy}>
          Play all
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={session.toggleFollowing}
          aria-pressed={turn.following}
        >
          Follow agent
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={session.toggleRevealing}
          aria-pressed={turn.revealing}
        >
          Reveal
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => {
            writeVimSetting(!vim);
            setVim(!vim);
          }}
          aria-pressed={vim}
        >
          Vim
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => setShowFile((shown) => !shown)}
          aria-pressed={showFile}
        >
          File
        </button>
      </header>
      {showFile ? (
        <section className="playground-file" aria-label="File on disk">
          <h2>File on disk</h2>
          <pre>{turn.file}</pre>
        </section>
      ) : null}
      <AtlasEditor
        className="playground-editor"
        text={session.text}
        awareness={session.awareness}
        extensions={extensions}
        vim={vim}
      />
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Playground />
    </StrictMode>,
  );
}
