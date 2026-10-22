import {
  EnvironmentId,
  MessageId,
  ThreadId,
  type AssistantCitation,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { ComposerContextId } from "@t3tools/contracts";
import {
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { DEFAULT_RESOLVED_TRIGGERS } from "@t3tools/shared/keybindingTriggers";
import { undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";

import { vimInsertMode } from "@mercurian/editor/vim";

import { onOpenCommandPalette } from "~/commandPaletteBus";
import { handleLeaderRequests, pendingExOrigin, releaseExOrigin } from "~/whichKey/doors";
import { exLineGroups } from "~/whichKey/exPalette";

import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
} from "~/composer-logic";
import { ComposerChipRegistry, composerChipsField } from "./composerChips";
import { ComposerEditor, type ComposerEditorHost, type ComposerEditorMode } from "./composerEditor";

const editors: ComposerEditor[] = [];

/** When the tests type: the clock stands still here, and a pause is added to it. */
const TYPED_AT = Date.UTC(2026, 0, 1);

/** Stops the clock at `TYPED_AT` for a test, and destroys its editors as it ends. */
function cleanup(): Disposable {
  vi.setSystemTime(TYPED_AT);
  return {
    [Symbol.dispose]() {
      for (const editor of editors.splice(0)) editor.destroy();
      document.body.replaceChildren();
      vi.useRealTimers();
    },
  };
}

function mount(
  value: string,
  options: {
    mode?: ComposerEditorMode;
    cursor?: number;
    disabled?: boolean;
    vim?: boolean;
    skills?: ReadonlyArray<ServerProviderSkill>;
    host?: Partial<ComposerEditorHost>;
  } = {},
) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const onChange = vi.fn<ComposerEditorHost["onChange"]>();
  const openCitationComment = vi.fn<ComposerEditorHost["openCitationComment"]>();
  const host: ComposerEditorHost = {
    onChange,
    onEmptyChange: () => {},
    openCitationComment,
    ...options.host,
  };
  const registry = new ComposerChipRegistry();
  const editor = new ComposerEditor({
    parent,
    mode: options.mode ?? "rich",
    value,
    cursor: options.cursor ?? 0,
    disabled: options.disabled ?? false,
    vim: options.vim ?? false,
    skills: options.skills ?? [],
    presentation: { className: "", attributes: {} },
    registry,
    host: () => host,
  });
  editors.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  editor.syncControlled(value, options.cursor ?? 0);
  return { editor, view: editor.view, onChange, openCitationComment, registry };
}

const docOf = (editor: ComposerEditor) => editor.view.state.doc.toString();

function select(editor: ComposerEditor, anchor: number, head = anchor) {
  editor.view.dispatch({
    selection: EditorSelection.range(anchor, head),
    userEvent: "select",
  });
}

function type(editor: ComposerEditor, text: string, at = TYPED_AT) {
  const { view } = editor;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    userEvent: "input.type",
    annotations: Transaction.time.of(at),
  });
}

/**
 * Types text the way the browser does, through the editor's input handlers, over the
 * selection or over the range a composition replaces.
 */
function typeOverSelection(
  editor: ComposerEditor,
  text: string,
  { from, to }: { from: number; to: number } = editor.view.state.selection.main,
) {
  const { view } = editor;
  const insert = () => view.state.update({ changes: { from, to, insert: text } });
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, text, insert));
  if (!handled) view.dispatch(insert());
}

function press(
  editor: ComposerEditor,
  key: string,
  init: Omit<KeyboardEventInit, "key"> = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

class FakeClipboard {
  readonly data = new Map<string, string>();
  readonly files: File[] = [];
  constructor(entries: Record<string, string> = {}) {
    for (const [type, value] of Object.entries(entries)) this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? "";
  }
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
}

function clipboardEvent(
  editor: ComposerEditor,
  type: "copy" | "cut" | "paste",
  clipboard: FakeClipboard,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboard });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

const MENTION = "[a.ts](src/a.ts)";
const PROMPT = `Look at ${MENTION} and $review-skill please`;

describe("cursor spaces", () => {
  it("agrees with the composer's cursor helpers at every position", () => {
    using _cleanup = cleanup();
    const { editor } = mount(PROMPT, { mode: "plain" });
    for (let offset = 0; offset <= PROMPT.length; offset++) {
      select(editor, offset);
      const expected = collapseExpandedComposerCursor(PROMPT, offset);
      expect(editor.readSnapshot().cursor, `offset ${offset}`).toBe(expected);
    }
    const collapsedLength = collapseExpandedComposerCursor(PROMPT, PROMPT.length);
    for (let cursor = 0; cursor <= collapsedLength; cursor++) {
      editor.focusAt(cursor);
      expect(editor.view.state.selection.main.head, `cursor ${cursor}`).toBe(
        expandCollapsedComposerCursor(PROMPT, cursor),
      );
    }
  });

  it("uses plain offsets in literal mode, where nothing is a chip", () => {
    using _cleanup = cleanup();
    const { editor } = mount(PROMPT, { mode: "literal" });
    select(editor, 12);
    expect(editor.readSnapshot()).toEqual({
      value: PROMPT,
      cursor: 12,
      expandedCursor: 12,
      contextIds: [],
    });
    expect(editor.view.state.field(composerChipsField, false)).toBeUndefined();
  });
});

describe("reporting changes", () => {
  it("reports typing with both cursors and the referenced context ids", () => {
    using _cleanup = cleanup();
    const reference = formatComposerContextReference({
      kind: "terminal",
      contextId: ComposerContextId.make("term-1"),
      label: "Build",
    });
    const value = `${reference} run`;
    const { editor, onChange } = mount(value, { cursor: 5 });
    select(editor, value.length);
    onChange.mockClear();
    type(editor, "!");
    const next = `${value}!`;
    expect(onChange).toHaveBeenCalledWith(
      next,
      collapseExpandedComposerCursor(next, next.length),
      next.length,
      false,
      ["term-1"],
    );
  });

  it("reports a selection change once, and a selection that keeps the snapshot as a visible change", () => {
    using _cleanup = cleanup();
    const onVisibleSelectionChange = vi.fn();
    const { editor, onChange } = mount("hello world", { host: { onVisibleSelectionChange } });
    select(editor, 2);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The caret (the selection's start) stays put while the selection grows.
    select(editor, 2, 5);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onVisibleSelectionChange).toHaveBeenCalledTimes(1);
    select(editor, 2, 5);
    expect(onVisibleSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("suppresses the trigger next to a chip and inside code", () => {
    using _cleanup = cleanup();
    const value = `${MENTION} x\n\`\`\`\n@co\n\`\`\``;
    const { editor, onChange } = mount(value);
    select(editor, MENTION.length);
    expect(onChange.mock.lastCall?.[3]).toBe(true);
    select(editor, MENTION.length + 2);
    expect(onChange.mock.lastCall?.[3]).toBe(false);
    select(editor, value.indexOf("@co") + 3);
    expect(onChange.mock.lastCall?.[3]).toBe(true);
  });
});

describe("controlled value", () => {
  it("applies a store rewrite without echoing it, and undo takes it back as one step", () => {
    using _cleanup = cleanup();
    const { editor, onChange } = mount("fix @src", { cursor: 8 });
    editor.view.focus();
    onChange.mockClear();
    const next = `fix ${MENTION} `;
    editor.syncControlled(next, collapseExpandedComposerCursor(next, next.length));
    expect(docOf(editor)).toBe(next);
    expect(editor.view.state.selection.main.head).toBe(next.length);
    expect(onChange).not.toHaveBeenCalled();
    undo(editor.view);
    expect(docOf(editor)).toBe("fix @src");
  });

  it("moves the caret for a cursor-only change only while focused", () => {
    using _cleanup = cleanup();
    const { editor } = mount("hello world", { cursor: 0 });
    editor.syncControlled("hello world", 5);
    expect(editor.view.state.selection.main.head).toBe(0);
    editor.view.focus();
    editor.syncControlled("hello world", 7);
    expect(editor.view.state.selection.main.head).toBe(7);
  });

  it("keeps a CRLF draft verbatim", () => {
    using _cleanup = cleanup();
    const { editor } = mount("a\r\nb");
    expect(docOf(editor)).toBe("a\r\nb");
    expect(editor.readSnapshot().value).toBe("a\r\nb");
  });
});

describe("chips", () => {
  it("are atomic: arrows skip a chip and Backspace removes it whole", () => {
    using _cleanup = cleanup();
    for (const mode of ["rich", "plain"] as const) {
      const value = `x ${MENTION} y`;
      const { editor } = mount(value, { mode });
      editor.view.focus();
      select(editor, 2);
      press(editor, "ArrowRight");
      expect(editor.view.state.selection.main.head, mode).toBe(2 + MENTION.length);
      press(editor, "ArrowLeft");
      expect(editor.view.state.selection.main.head, mode).toBe(2);
      select(editor, 2 + MENTION.length);
      press(editor, "Backspace");
      expect(docOf(editor), mode).toBe("x  y");
    }
  });

  it("stay source text inside a code block in rich mode, and are chips in plain mode", () => {
    using _cleanup = cleanup();
    const value = `\`\`\`\n${MENTION} \n\`\`\`\n${MENTION} `;
    const rich = mount(value, { mode: "rich" });
    expect(rich.view.state.field(composerChipsField).chips.map((chip) => chip.from)).toEqual([
      value.lastIndexOf(MENTION),
    ]);
    const plain = mount(value, { mode: "plain" });
    expect(plain.view.state.field(composerChipsField).chips).toHaveLength(2);
  });
});

describe("skill chips", () => {
  const babysit: ServerProviderSkill = {
    name: "babysit",
    path: "/skills/babysit/SKILL.md",
    enabled: true,
  };
  const skillChips = (editor: ComposerEditor) =>
    editor.view.state
      .field(composerChipsField)
      .chips.filter((chip) => chip.kind === "skill")
      .map((chip) => chip.source);

  it("are only the skills the provider offers to users, following the provider's skills", () => {
    using _cleanup = cleanup();
    const value = "echo $HOME $babysit $review €Euro now";
    const agentOnly = { ...babysit, name: "review", userInvocable: false };
    const { editor } = mount(value, { skills: [babysit, agentOnly] });
    expect(skillChips(editor)).toEqual(["$babysit"]);
    editor.setSkills([{ ...babysit, enabled: false }, agentOnly]);
    expect(skillChips(editor)).toEqual([]);
    editor.setSkills([babysit, { ...agentOnly, userInvocable: true }]);
    expect(skillChips(editor)).toEqual(["$babysit", "$review"]);
    expect(docOf(editor)).toBe(value);
  });

  it("leave other dollar names editable: the caret steps into them", () => {
    using _cleanup = cleanup();
    const { editor } = mount("echo $HOME $babysit now", { skills: [babysit] });
    editor.view.focus();
    select(editor, "echo $HOME".length);
    press(editor, "ArrowLeft");
    expect(editor.view.state.selection.main.head).toBe("echo $HOM".length);
    select(editor, "echo $HOME $babysit".length);
    press(editor, "ArrowLeft");
    expect(editor.view.state.selection.main.head).toBe("echo $HOME ".length);
  });

  it("keep the $ menu on dollar text that is not a chip, before a space or a line break", () => {
    using _cleanup = cleanup();
    const { editor, onChange } = mount("use  now\nfirst \n$babysit tail", { skills: [babysit] });
    // The store takes each change and hands it back, as the composer does.
    const trigger = () => {
      const [value, cursor, expandedCursor, suppressTrigger] = onChange.mock.lastCall!;
      editor.syncControlled(value, cursor);
      return suppressTrigger ? null : detectComposerTrigger(value, expandedCursor);
    };
    select(editor, "use ".length);
    type(editor, "$bab");
    expect(trigger()).toMatchObject({ kind: "skill", query: "bab" });
    select(editor, docOf(editor).indexOf("\n$babysit"));
    type(editor, "$bab");
    expect(trigger()).toMatchObject({ kind: "skill", query: "bab" });
    const chipStart = docOf(editor).indexOf("$babysit");
    select(editor, chipStart + "$babysit".length);
    expect(onChange.mock.lastCall?.[3]).toBe(true);
    select(editor, chipStart);
    expect(onChange.mock.lastCall?.[3]).toBe(true);
  });

  it("pads a pasted skill so it completes as a chip, and pastes other dollar text as it is", () => {
    using _cleanup = cleanup();
    for (const [pasted, expected] of [
      ["$babysit", "echo $babysit "],
      ["$HOME", "echo $HOME"],
    ] as const) {
      const { editor } = mount("echo ", { skills: [babysit] });
      select(editor, 5);
      clipboardEvent(editor, "paste", new FakeClipboard({ "text/plain": pasted }));
      expect(docOf(editor), pasted).toBe(expected);
    }
  });
});

describe("surround", () => {
  it("leaves composed text and a range other than the selection unwrapped", () => {
    using _cleanup = cleanup();
    // A dead key or IME replacing the selection.
    const composing = mount("word");
    select(composing.editor, 0, 4);
    composing.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart"));
    typeOverSelection(composing.editor, '"');
    expect(docOf(composing.editor)).toBe('"');

    // A Compose key's preedit text, replaced with no selection.
    const preedit = mount("·");
    select(preedit.editor, 1);
    typeOverSelection(preedit.editor, '"', { from: 0, to: 1 });
    expect(docOf(preedit.editor)).toBe('"');

    const outside = mount("word");
    select(outside.editor, 0, 4);
    typeOverSelection(outside.editor, '"', { from: 1, to: 2 });
    expect(docOf(outside.editor)).toBe('w"rd');
  });

  it("wraps a selection in brackets and quotes", () => {
    using _cleanup = cleanup();
    const { editor } = mount("say hello now");
    select(editor, 4, 9);
    typeOverSelection(editor, "(");
    expect(docOf(editor)).toBe("say (hello) now");
    expect(editor.view.state.selection.main).toMatchObject({ from: 5, to: 10 });
  });

  it("never wraps a chip, the space beside a mention, or literal text", () => {
    using _cleanup = cleanup();
    const value = `see ${MENTION} ok`;
    const chip = mount(value);
    select(chip.editor, 0, 8);
    typeOverSelection(chip.editor, "[");
    expect(docOf(chip.editor)).toBe(`[${value.slice(8)}`);

    const mention = "see @README.md ok";
    const spaced = mount(mention);
    select(spaced.editor, 14, 17);
    typeOverSelection(spaced.editor, '"');
    expect(docOf(spaced.editor)).toBe('see @README.md"');

    const literal = mount("say hello", { mode: "literal" });
    select(literal.editor, 4, 9);
    typeOverSelection(literal.editor, "(");
    expect(docOf(literal.editor)).toBe("say (");
  });
});

describe("clipboard", () => {
  const reference = formatComposerContextReference({
    kind: "terminal",
    contextId: ComposerContextId.make("term-1"),
    label: "Build",
  });

  it("copies the source slice and a context fragment for referenced chips", () => {
    using _cleanup = cleanup();
    const value = `see ${reference} now`;
    const buildContextClipboardFragment = vi.fn(() => "FRAGMENT");
    const { editor } = mount(value, { host: { buildContextClipboardFragment } });
    select(editor, 0, value.length);
    const clipboard = new FakeClipboard();
    const event = clipboardEvent(editor, "copy", clipboard);
    expect(event.defaultPrevented).toBe(true);
    expect(clipboard.getData("text/plain")).toBe(value);
    expect(buildContextClipboardFragment).toHaveBeenCalledWith(["term-1"]);
    expect(clipboard.getData(COMPOSER_CONTEXT_CLIPBOARD_MIME)).toBe("FRAGMENT");
    expect(clipboard.getData("text/html")).toContain("data-t3-context-fragment");
  });

  it("cuts as one undo step and copies nothing without a selection", () => {
    using _cleanup = cleanup();
    const { editor } = mount("abc def");
    editor.view.focus();
    select(editor, 7);
    type(editor, "g");
    select(editor, 0, 4);
    clipboardEvent(editor, "cut", new FakeClipboard());
    expect(docOf(editor)).toBe("defg");
    undo(editor.view);
    expect(docOf(editor)).toBe("abc defg");

    select(editor, 2);
    const empty = new FakeClipboard();
    clipboardEvent(editor, "copy", empty);
    expect(empty.data.size).toBe(0);
  });

  it("pads a pasted mention so it completes as a chip", () => {
    using _cleanup = cleanup();
    const { editor } = mount("hi");
    select(editor, 2);
    clipboardEvent(editor, "paste", new FakeClipboard({ "text/plain": "@README.md" }));
    expect(docOf(editor)).toBe("hi @README.md ");
  });

  it("pastes verbatim inside code", () => {
    using _cleanup = cleanup();
    const value = "```\n\n```";
    const { editor } = mount(value);
    select(editor, 4);
    clipboardEvent(editor, "paste", new FakeClipboard({ "text/plain": "@README.md" }));
    expect(docOf(editor)).toBe("```\n@README.md\n```");
  });

  it("keeps a path continuing an @ query literal, so file search sees it as typed", () => {
    using _cleanup = cleanup();
    const { editor } = mount("open @src/");
    select(editor, 10);
    clipboardEvent(editor, "paste", new FakeClipboard({ "text/plain": "__init__.py" }));
    expect(docOf(editor)).toBe("open @src/__init__.py");
  });

  it("imports a structured paste's records and rewrites their ids, as one undo step", () => {
    using _cleanup = cleanup();
    const fragment = encodeComposerContextFragment({
      version: 1,
      source: { environmentId: EnvironmentId.make("env") },
      records: [
        {
          version: 1,
          contextId: ComposerContextId.make("term-1"),
          kind: "terminal",
          label: "Build",
          terminalId: "build",
          terminalLabel: "Build",
          lineStart: 1,
          lineEnd: 1,
          text: "ok",
        },
      ],
    })!;
    const importContextFragment = vi.fn(() => new Map([["term-1", "term-2"]]));
    const { editor } = mount("x", { host: { importContextFragment } });
    editor.view.focus();
    select(editor, 1);
    clipboardEvent(
      editor,
      "paste",
      new FakeClipboard({
        "text/plain": ` ${reference}`,
        [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment,
      }),
    );
    expect(importContextFragment).toHaveBeenCalledTimes(1);
    expect(docOf(editor)).toBe(`x ${reference.replace("term-1", "term-2")}`);
    undo(editor.view);
    expect(docOf(editor)).toBe("x");
  });
});

describe("keys", () => {
  it("offers every key to the composer first, and a claimed key does nothing else", () => {
    using _cleanup = cleanup();
    const onCommandKeyDown = vi.fn<NonNullable<ComposerEditorHost["onCommandKeyDown"]>>(() => true);
    const { editor } = mount("hello", { host: { onCommandKeyDown } });
    editor.view.focus();
    select(editor, 5);
    for (const key of ["Enter", "Escape", "ArrowUp", "ArrowDown", "Tab"]) {
      const event = press(editor, key);
      expect(event.defaultPrevented, key).toBe(true);
    }
    expect(onCommandKeyDown.mock.calls.map(([key]) => key)).toEqual([
      "Enter",
      "Escape",
      "ArrowUp",
      "ArrowDown",
      "Tab",
    ]);
    expect(docOf(editor)).toBe("hello");
  });

  it("tells the composer when Enter is in a list item, and continues the list when it declines", () => {
    using _cleanup = cleanup();
    const onCommandKeyDown = vi.fn(() => false);
    const { editor } = mount("- one", { host: { onCommandKeyDown } });
    editor.view.focus();
    select(editor, 5);
    press(editor, "Enter");
    expect(onCommandKeyDown).toHaveBeenCalledWith("Enter", expect.anything(), true);
    expect(docOf(editor)).toBe("- one\n- ");
  });

  it("ends a quote with a blank line on leaving it, so the text after it is not quoted", () => {
    using _cleanup = cleanup();
    const { editor } = mount("> quoted", { host: { onCommandKeyDown: () => false } });
    editor.view.focus();
    select(editor, 8);
    press(editor, "Enter");
    press(editor, "Enter");
    type(editor, "my comment");
    expect(docOf(editor)).toBe("> quoted\n\nmy comment");
  });

  it("keeps a list marker typed without its space, where Enter makes a new line", () => {
    using _cleanup = cleanup();
    for (const value of ["2.", "1)", "-", "- a\n-"]) {
      const { editor } = mount(value, { host: { onCommandKeyDown: () => false } });
      editor.view.focus();
      select(editor, value.length);
      press(editor, "Enter");
      expect(docOf(editor), value).toBe(`${value}\n`);
    }
  });

  it("makes a new line on an unclaimed Enter in plain mode", () => {
    using _cleanup = cleanup();
    const onCommandKeyDown = vi.fn(() => false);
    const { editor } = mount("- one", { mode: "plain", host: { onCommandKeyDown } });
    editor.view.focus();
    select(editor, 5);
    press(editor, "Enter");
    expect(onCommandKeyDown).toHaveBeenCalledWith("Enter", expect.anything(), false);
    expect(docOf(editor)).toBe("- one\n");
  });

  it("keeps Enter and Tab inside code for the code", () => {
    using _cleanup = cleanup();
    const onCommandKeyDown = vi.fn(() => true);
    const value = "```\n  x\n```";
    const { editor } = mount(value, { host: { onCommandKeyDown } });
    editor.view.focus();
    select(editor, 7);
    press(editor, "Enter");
    expect(docOf(editor)).toBe("```\n  x\n  \n```");
    press(editor, "Tab");
    expect(docOf(editor)).toBe("```\n  x\n    \n```");
    expect(onCommandKeyDown).not.toHaveBeenCalled();
    // Sending from code is still Mod+Enter.
    press(editor, "Enter", { ctrlKey: true });
    expect(onCommandKeyDown).toHaveBeenCalledTimes(1);
  });

  it("lets an unclaimed Tab in prose through, for focus order", () => {
    using _cleanup = cleanup();
    const { editor } = mount("hello", { host: { onCommandKeyDown: () => false } });
    editor.view.focus();
    select(editor, 5);
    const event = press(editor, "Tab");
    expect(event.defaultPrevented).toBe(false);
    expect(docOf(editor)).toBe("hello");
  });

  it("swallows Enter while an IME composes", () => {
    using _cleanup = cleanup();
    const onCommandKeyDown = vi.fn(() => false);
    const { editor } = mount("ni", { host: { onCommandKeyDown } });
    editor.view.focus();
    select(editor, 2);
    press(editor, "Enter", { isComposing: true });
    press(editor, "Enter", { keyCode: 229 });
    expect(onCommandKeyDown).not.toHaveBeenCalled();
    expect(docOf(editor)).toBe("ni");
  });
});

describe("undo grouping", () => {
  it("starts a new step when typing turns into deleting", () => {
    using _cleanup = cleanup();
    const { editor } = mount("");
    editor.view.focus();
    type(editor, "a");
    type(editor, "b");
    editor.view.dispatch({
      changes: { from: 1, to: 2 },
      selection: EditorSelection.cursor(1),
      userEvent: "delete.backward",
    });
    expect(docOf(editor)).toBe("a");
    undo(editor.view);
    expect(docOf(editor)).toBe("ab");
    undo(editor.view);
    expect(docOf(editor)).toBe("");
  });
});

describe("undo pauses", () => {
  it("starts a new step after a second without changes", () => {
    using _cleanup = cleanup();
    const { editor } = mount("");
    editor.view.focus();
    type(editor, "ab", TYPED_AT);
    type(editor, "cd", TYPED_AT + 1500);
    undo(editor.view);
    expect(docOf(editor)).toBe("ab");
  });
});

describe("Vim mode", () => {
  const vimMode = (editor: ComposerEditor) => editor.view.dom.getAttribute("data-vim-mode");
  const sends = () =>
    vi.fn<NonNullable<ComposerEditorHost["onCommandKeyDown"]>>((key) => key === "Enter");

  /** Whether a key got past the editor to the page. */
  function reachesPage(editor: ComposerEditor, key: string) {
    let reached = false;
    const listener = () => {
      reached = true;
    };
    document.body.addEventListener("keydown", listener);
    press(editor, key);
    document.body.removeEventListener("keydown", listener);
    return reached;
  }

  it("starts in insert mode with the composer's keys, and Escape enters normal mode in place", async () => {
    using _cleanup = cleanup();
    const onCommandKeyDown = sends();
    const { editor } = mount("hello", { vim: true, host: { onCommandKeyDown } });
    editor.view.focus();
    select(editor, 5);
    await Promise.resolve();
    expect(vimInsertMode(editor.view)).toBe(true);
    expect(vimMode(editor)).toBe("insert");

    press(editor, "Enter");
    expect(onCommandKeyDown).toHaveBeenLastCalledWith("Enter", expect.anything(), false);

    // The composer is offered Escape first (to close a menu); unclaimed, it is Vim's.
    expect(reachesPage(editor, "Escape")).toBe(false);
    expect(onCommandKeyDown).toHaveBeenLastCalledWith("Escape", expect.anything());
    expect(vimInsertMode(editor.view)).toBe(false);
    expect(vimMode(editor)).toBe("normal");
    expect(docOf(editor)).toBe("hello");
  });

  it("gives Vim the keys outside insert mode, but Mod+Enter still sends", () => {
    using _cleanup = cleanup();
    const onCommandKeyDown = sends();
    const { editor } = mount("hello", { vim: true, host: { onCommandKeyDown } });
    editor.view.focus();
    select(editor, 0);
    press(editor, "Escape");
    onCommandKeyDown.mockClear();

    press(editor, "x");
    expect(docOf(editor)).toBe("ello");
    // (Only where these keys go is checked, not what Vim's motions make of the text.)
    for (const key of ["Enter", "ArrowUp", "ArrowDown", "Tab"]) press(editor, key);
    expect(onCommandKeyDown).not.toHaveBeenCalled();

    press(editor, "Enter", { ctrlKey: true });
    expect(onCommandKeyDown).toHaveBeenCalledTimes(1);
    expect(onCommandKeyDown).toHaveBeenCalledWith("Enter", expect.anything());
  });

  it("leaves Escape to the composer and the page with Vim off", () => {
    using _cleanup = cleanup();
    const onCommandKeyDown = vi.fn(() => false);
    const { editor } = mount("hello", { host: { onCommandKeyDown } });
    editor.view.focus();
    expect(reachesPage(editor, "Escape")).toBe(true);
    expect(onCommandKeyDown).toHaveBeenCalledWith("Escape", expect.anything());
  });

  it("opens no @ or $ menu while Vim moves the caret in normal mode", () => {
    using _cleanup = cleanup();
    const { editor, onChange } = mount("see @src", { vim: true });
    editor.view.focus();
    select(editor, 8);
    press(editor, "Escape");
    expect(onChange.mock.lastCall?.[3]).toBe(true);
    press(editor, "a");
    type(editor, "x");
    expect(onChange.mock.lastCall?.[3]).toBe(false);
  });

  it("is back in insert mode once the store empties the prompt, as a send does", () => {
    using _cleanup = cleanup();
    const { editor } = mount("hello", { vim: true });
    editor.view.focus();
    press(editor, "Escape");
    expect(vimInsertMode(editor.view)).toBe(false);
    editor.syncControlled("", 0);
    expect(vimInsertMode(editor.view)).toBe(true);
  });

  it("undoes a whole insert session in one u, whatever its pauses, and Ctrl-r redoes it", () => {
    using _cleanup = cleanup();
    const { editor } = mount("", { vim: true });
    editor.view.focus();
    type(editor, "ab", TYPED_AT);
    type(editor, "cd", TYPED_AT + 5000);
    press(editor, "Escape");
    press(editor, "u");
    expect(docOf(editor)).toBe("");
    press(editor, "r", { ctrlKey: true });
    expect(docOf(editor)).toBe("abcd");
  });

  it("makes each Vim change its own step", () => {
    using _cleanup = cleanup();
    const { editor } = mount("one two", { vim: true });
    editor.view.focus();
    select(editor, 0);
    press(editor, "Escape");
    press(editor, "x");
    press(editor, "c");
    press(editor, "w");
    type(editor, "uno");
    press(editor, "Escape");
    expect(docOf(editor)).toBe("uno two");
    press(editor, "u");
    expect(docOf(editor)).toBe("ne two");
    press(editor, "u");
    expect(docOf(editor)).toBe("one two");
  });

  it("opens the palette as the ex line on : in normal mode, and runs the editor's own commands back in the draft", async () => {
    using _cleanup = cleanup();
    const opened: unknown[] = [];
    const stop = onOpenCommandPalette((detail) => opened.push(detail));
    const { editor } = mount("hello world", { vim: true });
    const form = document.createElement("form");
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submitted);
    document.body.append(form);
    form.append(editor.view.dom.parentElement!);
    editor.view.focus();
    press(editor, "Escape");

    press(editor, ":");
    stop();
    expect(opened).toEqual([{ query: ":" }]);
    // Vim's own ex line stayed shut.
    expect(editor.view.dom.querySelector(".cm-panels input")).toBeNull();
    const origin = pendingExOrigin();
    expect(origin?.view).toBe(editor.view);

    // `:w` sends the draft as the send button does, through the composer's form.
    expect(origin?.write?.label).toBe("Send the draft");
    origin?.write?.run();
    expect(submitted).toHaveBeenCalledOnce();

    // A line the palette does not know is the editor's: `:s` substitutes in the draft.
    const [group] = exLineGroups("s/world/there/", {
      origin,
      triggers: DEFAULT_RESOLVED_TRIGGERS,
      command: () => ({ label: "", disabled: true, run: () => {} }),
      leaderLabel: "Space",
      actionItems: [],
      setLine: () => {},
      threadItems: [],
      chatTabThreadIds: [],
      overviews: [],
      showWikis: () => {},
    });
    const [item] = group?.items ?? [];
    expect(item?.disabled).toBeUndefined();
    if (item?.kind !== "action") throw new Error("no row to run in the editor");
    // It runs a frame after the palette closes; the test runs that frame itself.
    const frames: FrameRequestCallback[] = [];
    const frame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => frames.push(callback));
    await item.run();
    frame.mockRestore();
    for (const callback of frames) callback(0);
    expect(docOf(editor)).toBe("hello there");
    releaseExOrigin(origin);
  });

  it("opens the keyboard menu on Space in normal mode, which stays Vim's without a menu", () => {
    using _cleanup = cleanup();
    const { editor } = mount("hello", { vim: true });
    editor.view.focus();
    select(editor, 0);
    press(editor, "Escape");
    press(editor, " ");
    // No menu on the page: Space is Vim's step right.
    expect(editor.view.state.selection.main.head).toBe(1);

    const leader = vi.fn(() => true);
    const stop = handleLeaderRequests({ open: leader, key: () => " " });
    press(editor, " ");
    stop();
    expect(leader).toHaveBeenCalledWith(expect.objectContaining({ view: editor.view }));
    expect(editor.view.state.selection.main.head).toBe(1);
  });

  it("switches in place, keeping the draft, and starts in insert mode when turned on", async () => {
    using _cleanup = cleanup();
    const { editor } = mount("draft");
    const view = editor.view;
    expect(vimInsertMode(view)).toBeNull();
    editor.setVim(true);
    await Promise.resolve();
    expect(editor.view).toBe(view);
    expect(vimInsertMode(view)).toBe(true);
    expect(vimMode(editor)).toBe("insert");
    editor.setVim(false);
    expect(vimInsertMode(view)).toBeNull();
    expect(vimMode(editor)).toBeNull();
    expect(docOf(editor)).toBe("draft");
  });
});

describe("visual edges", () => {
  it("is never on the edge across a hard line break, and always in an empty prompt", () => {
    using _cleanup = cleanup();
    const { editor } = mount("a\nb");
    editor.view.focus();
    select(editor, 3);
    expect(editor.isCaretOnVisualEdge("start")).toBe(false);
    select(editor, 0);
    expect(editor.isCaretOnVisualEdge("end")).toBe(false);
    const empty = mount("");
    expect(empty.editor.isCaretOnVisualEdge("start")).toBe(true);
    expect(empty.editor.isCaretOnVisualEdge("end")).toBe(true);
  });
});

describe("citation comments", () => {
  const citation: AssistantCitation = {
    version: 1,
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    text: "quoted",
    start: 0,
    end: 6,
    prefix: "",
    suffix: "",
  };
  const source = serializeAssistantCitation(citation);

  it("opens a requested comment once the value carrying the citation lands", () => {
    using _cleanup = cleanup();
    const { editor, openCitationComment } = mount("ask");
    const value = `ask ${source} `;
    const request = {
      previousValue: "ask",
      value,
      citationStart: 4,
      sourceAnchor: {} as never,
      insertedSpaces: { before: true, after: true },
    };
    editor.requestCitationComment(request);
    expect(openCitationComment).not.toHaveBeenCalled();
    editor.syncControlled(value, collapseExpandedComposerCursor(value, value.length));
    expect(openCitationComment).toHaveBeenCalledWith(4, request);
  });

  it("saves a comment into the citation's source and removes a cancelled fresh one with its spaces", () => {
    using _cleanup = cleanup();
    const value = `ask ${source} `;
    const { editor, registry, view } = mount(value);
    const entry = registry.entryAt(view, 4);
    expect(entry?.chip.kind).toBe("citation");
    expect(editor.saveCitationComment(entry!.dom, "why?")).toBe(true);
    const saved = serializeAssistantCitation(withAssistantCitationComment(citation, "why?"));
    expect(docOf(editor)).toBe(`ask ${saved} `);
    // The chip keeps its widget, so an open comment editor stays open.
    expect(registry.entryAt(view, 4)?.id).toBe(entry!.id);
    editor.removeCitation(entry!.dom, { before: true, after: true });
    expect(docOf(editor)).toBe("ask");
  });

  it("saves an unsaved comment into a prompt a question or approval replaces", () => {
    using _cleanup = cleanup();
    const value = `ask ${source} `;
    const saved = `ask ${serializeAssistantCitation(withAssistantCitationComment(citation, "why?"))} `;
    const onCitationDraftSave = vi.fn<NonNullable<ComposerEditorHost["onCitationDraftSave"]>>();
    const { editor, registry, view } = mount(value, { host: { onCitationDraftSave } });
    const entry = registry.entryAt(view, 4)!;
    editor.setCitationDraft(entry.dom, "why?");
    // A store rewrite that keeps the citation keeps its comment editor open.
    const longer = `${value}more`;
    editor.syncControlled(longer, collapseExpandedComposerCursor(longer, longer.length));
    expect(onCitationDraftSave).not.toHaveBeenCalled();
    editor.syncControlled("", 0);
    expect(onCitationDraftSave).toHaveBeenCalledExactlyOnceWith(longer, `${saved}more`);
    // Once saved, a later replacement has nothing to save.
    editor.syncControlled(value, 0);
    editor.syncControlled("", 0);
    expect(onCitationDraftSave).toHaveBeenCalledTimes(1);
  });

  it("saves an unsaved comment when the editor is replaced, but not a closed or unchanged one", () => {
    using _cleanup = cleanup();
    const value = `ask ${source} `;
    const onCitationDraftSave = vi.fn<NonNullable<ComposerEditorHost["onCitationDraftSave"]>>();
    const remounted = mount(value, { host: { onCitationDraftSave } });
    remounted.editor.setCitationDraft(remounted.registry.entryAt(remounted.view, 4)!.dom, "why?");
    editors.splice(editors.indexOf(remounted.editor), 1);
    remounted.editor.destroy();
    expect(onCitationDraftSave).toHaveBeenCalledExactlyOnceWith(
      value,
      `ask ${serializeAssistantCitation(withAssistantCitationComment(citation, "why?"))} `,
    );

    onCitationDraftSave.mockClear();
    const closed = mount(value, { host: { onCitationDraftSave } });
    const dom = closed.registry.entryAt(closed.view, 4)!.dom;
    closed.editor.setCitationDraft(dom, "why?");
    closed.editor.setCitationDraft(dom, null);
    closed.editor.syncControlled("", 0);
    const unchanged = mount(value, { host: { onCitationDraftSave } });
    unchanged.editor.setCitationDraft(unchanged.registry.entryAt(unchanged.view, 4)!.dom, " ");
    unchanged.editor.syncControlled("", 0);
    expect(onCitationDraftSave).not.toHaveBeenCalled();
  });

  it("cannot change a citation while disabled", () => {
    using _cleanup = cleanup();
    const value = `ask ${source} `;
    const { editor, registry, view } = mount(value, { disabled: true });
    const entry = registry.entryAt(view, 4);
    expect(editor.saveCitationComment(entry!.dom, "why?")).toBe(false);
    expect(docOf(editor)).toBe(value);
  });
});
