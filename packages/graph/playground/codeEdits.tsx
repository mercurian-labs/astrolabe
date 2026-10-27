/**
 * The code a story's play changed, shown as the agent changed it: the file at the turn's commit
 * lands as an edit over the file at the commit's parent, so the change is highlighted with the
 * agent's cursor after it. The code story's counterpart of `noteEdits.tsx`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LanguageDescription,
  HighlightStyle,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { yCollab } from "y-codemirror.next";
import { agentChanges } from "@mercurian/editor/collab/agent-changes";
import { createFileMirror } from "@mercurian/editor/bridge/file-mirror";

import { pickedPlays, type Memory, type PlayPick, type ThreadRecord } from "../src/index.ts";
import "./codeEdits.css";

/** The graph's rust accent, in the six-digit hex the editor's agent colours require. */
const AGENT_COLOR = "#b24a26";

/** What a code story fixture carries beyond the graph's shapes. */
interface StorySource {
  readonly repo: string;
  readonly paths: ReadonlyArray<string>;
}
interface Range {
  readonly startLine: number;
  readonly endLine: number;
}
interface CodeStoryLike {
  readonly memory: Memory;
  readonly thread: ThreadRecord;
}

/** The symbol a play wrote or amended, and where to fetch its file. */
interface Target {
  readonly story: string;
  readonly ref: string;
  readonly note: string;
  readonly name: string;
  readonly path: string;
  readonly range: Range | null;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "ready"; readonly before: string; readonly after: string };

/**
 * The write or amend a selected play (else the checkpoint's turn) makes first,
 * of anything but a folder: a definition, or a new file.
 */
export function playTarget(
  story: CodeStoryLike,
  checkpoint: number,
  play: PlayPick | null,
): Target | null {
  const turn = story.thread.turns[checkpoint];
  if (turn === undefined) return null;
  const order = play === null ? turn.events.map((_, index) => index) : pickedPlays(play);
  for (const index of order) {
    const event = turn.events[index];
    if (event === undefined || (event.kind !== "write" && event.kind !== "amend")) continue;
    const range = event.range ?? null;
    if (event.group === undefined || range === null) continue;
    return {
      story: story.memory.id,
      ref: turn.id,
      note: event.note,
      name: event.name ?? event.note,
      path: event.group,
      range,
    };
  }
  return null;
}

async function fetchText(target: Target, parent: boolean): Promise<string> {
  const query = new URLSearchParams({ story: target.story, ref: target.ref, path: target.path });
  if (parent) query.set("parent", "1");
  const response = await fetch(`/__code/file?${query.toString()}`);
  const body = await response.text();
  if (!response.ok) throw new Error(body || `${response.status}`);
  return body;
}

const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#d19a66" },
  { tag: [tags.string, tags.special(tags.string)], color: "#98c379" },
  { tag: [tags.number, tags.bool, tags.null], color: "#d19a66" },
  { tag: tags.comment, color: "#7f848e", fontStyle: "italic" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#e5c07b" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#61afef" },
  { tag: [tags.definition(tags.variableName), tags.propertyName], color: "#e06c75" },
  { tag: tags.operator, color: "#abb2bf" },
]);

/** The view's look: the playground's paper and ink, and a highlight style for each theme. */
function themeOf(theme: "light" | "dark"): Extension {
  return [
    EditorView.theme(
      {
        "&": { backgroundColor: "var(--atlas-paper)", color: "var(--atlas-ink)", height: "100%" },
        ".cm-gutters": {
          backgroundColor: "var(--atlas-paper)",
          color: "var(--atlas-muted)",
          borderRight: "1px solid var(--atlas-rule)",
        },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
        // The agent's cursor says whose it is all the time, as in the Atlas Editor.
        ".cm-ySelectionInfo": { opacity: 1 },
      },
      { dark: theme === "dark" },
    ),
    syntaxHighlighting(theme === "dark" ? darkHighlight : defaultHighlightStyle, {
      fallback: true,
    }),
  ];
}

export interface CodeView {
  readonly view: EditorView;
  setTheme(theme: "light" | "dark"): void;
  destroy(): void;
}

/**
 * A read-only code view in `host`: the file's text at the parent commit, then
 * the commit's text landed over it as the agent's edit (highlighted, the
 * agent's cursor after it), highlighted for the file's language once that
 * loads, and scrolled to `range` once the edit has landed.
 */
export function mountCodeView(
  host: HTMLElement,
  options: {
    readonly before: string;
    readonly after: string;
    readonly path: string;
    readonly range: Range | null;
    readonly turn: string;
    readonly theme: "light" | "dark";
  },
): CodeView {
  const mirror = createFileMirror(options.before, {
    name: "Agent",
    color: AGENT_COLOR,
    turnId: options.turn,
  });
  mirror.write(options.after);
  const language = new Compartment();
  const themes = new Compartment();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: mirror.text.toString(),
      extensions: [
        yCollab(mirror.text, mirror.awareness, { undoManager: false }),
        agentChanges(mirror.text, mirror.awareness),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        language.of([]),
        themes.of(themeOf(options.theme)),
      ],
    }),
  });
  let live = true;
  mirror.attach();
  // The held write lands a microtask after attach; then bring the symbol into view.
  const scroll = setTimeout(() => {
    if (!live || options.range === null) return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(options.range.startLine, 1), doc.lines));
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }) });
  }, 0);
  void LanguageDescription.matchFilename(languages, options.path)
    ?.load()
    .then((support) => {
      if (live) view.dispatch({ effects: language.reconfigure(support) });
    });
  return {
    view,
    setTheme(theme) {
      if (live) view.dispatch({ effects: themes.reconfigure(themeOf(theme)) });
    },
    destroy() {
      live = false;
      clearTimeout(scroll);
      mirror.detach();
      view.destroy();
      // After the view has let go of the mirror's documents.
      setTimeout(() => mirror.destroy(), 0);
    },
  };
}

function CodeViewHost({
  target,
  before,
  after,
  theme,
}: {
  target: Target;
  before: string;
  after: string;
  theme: "light" | "dark";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const codeView = useRef<CodeView | null>(null);
  // The theme a new view starts in; a change of theme reconfigures the view in place.
  const startTheme = useRef(theme);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const mounted = mountCodeView(host, {
      before,
      after,
      path: target.path,
      range: target.range,
      turn: target.ref,
      theme: startTheme.current,
    });
    codeView.current = mounted;
    return () => {
      codeView.current = null;
      mounted.destroy();
    };
  }, [target, before, after]);

  useEffect(() => {
    startTheme.current = theme;
    codeView.current?.setTheme(theme);
  }, [theme]);

  return <div ref={hostRef} className="code-edit-editor" />;
}

function CodeEdit({
  target,
  theme,
  onClose,
}: {
  target: Target;
  theme: "light" | "dark";
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let live = true;
    Promise.all([fetchText(target, true), fetchText(target, false)]).then(
      ([before, after]) => {
        if (live) setLoaded({ state: "ready", before, after });
      },
      (error: unknown) => {
        if (live)
          setLoaded({ state: "failed", message: String((error as Error).message ?? error) });
      },
    );
    return () => {
      live = false;
    };
  }, [target]);

  return (
    <section className="note-edit code-edit" aria-label={`Agent's change to ${target.name}`}>
      <header className="note-edit-bar">
        <span className="note-edit-dot" />
        <span className="note-edit-name code-edit-name">
          <span className="code-edit-path">{target.path}</span>
          <span className="code-edit-symbol"> · {target.name}</span>
        </span>
        <span className="note-edit-state">read only</span>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {loaded.state === "ready" ? (
        <CodeViewHost target={target} before={loaded.before} after={loaded.after} theme={theme} />
      ) : (
        <p className="code-edit-message">
          {loaded.state === "loading" ? "Reading the file…" : loaded.message}
        </p>
      )}
    </section>
  );
}

/**
 * The code view for a code story (a fixture with `source`): the symbol the
 * selected play, or else the checkpoint's turn, wrote or amended. One at a
 * time; another play replaces it; Escape or × closes it until the next.
 */
export function CodeEditPopup({
  story,
  checkpoint,
  play,
  theme,
}: {
  story: CodeStoryLike | null;
  checkpoint: number;
  play: PlayPick | null;
  theme: "light" | "dark";
}) {
  // The same story, checkpoint, and play keep the same target, so the view stays.
  const target = useMemo(() => {
    const hasSource = story !== null && (story as { source?: StorySource }).source !== undefined;
    return hasSource ? playTarget(story, checkpoint, play) : null;
  }, [story, checkpoint, play]);
  const key = target === null ? null : `${target.story}/${target.ref}/${target.note}`;
  const [closed, setClosed] = useState<string | null>(null);
  const open = target !== null && key !== closed;
  // Choosing a play opens its view again, even the one just closed.
  const [lastPlay, setLastPlay] = useState(play);
  if (play !== lastPlay) {
    setLastPlay(play);
    if (play !== null) setClosed(null);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setClosed(key);
    };
    // Captured: the play-by-play keeps its own Escape (clearing the play) from bubbling.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, key]);

  if (!open) return null;
  return <CodeEdit key={key} target={target} theme={theme} onClose={() => setClosed(key)} />;
}
