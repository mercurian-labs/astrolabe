// @vitest-environment jsdom

import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
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
import { undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { collapseExpandedComposerCursor, expandCollapsedComposerCursor } from "~/composer-logic";
import { ComposerChipRegistry, composerChipsField } from "./composerChips";
import { ComposerEditor, type ComposerEditorHost, type ComposerEditorMode } from "./composerEditor";

const editors: ComposerEditor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function mount(
  value: string,
  options: {
    mode?: ComposerEditorMode;
    cursor?: number;
    disabled?: boolean;
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

function type(editor: ComposerEditor, text: string) {
  const { view } = editor;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    userEvent: "input.type",
  });
}

/** Types one character the way the browser does, through the editor's input handlers. */
function typeOverSelection(editor: ComposerEditor, text: string) {
  const { view } = editor;
  const { from, to } = view.state.selection.main;
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
    const { editor } = mount("hello world", { cursor: 0 });
    editor.syncControlled("hello world", 5);
    expect(editor.view.state.selection.main.head).toBe(0);
    editor.view.focus();
    editor.syncControlled("hello world", 7);
    expect(editor.view.state.selection.main.head).toBe(7);
  });

  it("keeps a CRLF draft verbatim", () => {
    const { editor } = mount("a\r\nb");
    expect(docOf(editor)).toBe("a\r\nb");
    expect(editor.readSnapshot().value).toBe("a\r\nb");
  });
});

describe("chips", () => {
  it("are atomic: arrows skip a chip and Backspace removes it whole", () => {
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
    const value = `\`\`\`\n${MENTION} \n\`\`\`\n${MENTION} `;
    const rich = mount(value, { mode: "rich" });
    expect(rich.view.state.field(composerChipsField).chips.map((chip) => chip.from)).toEqual([
      value.lastIndexOf(MENTION),
    ]);
    const plain = mount(value, { mode: "plain" });
    expect(plain.view.state.field(composerChipsField).chips).toHaveLength(2);
  });
});

describe("surround", () => {
  it("wraps a selection in brackets and quotes", () => {
    const { editor } = mount("say hello now");
    select(editor, 4, 9);
    typeOverSelection(editor, "(");
    expect(docOf(editor)).toBe("say (hello) now");
    expect(editor.view.state.selection.main).toMatchObject({ from: 5, to: 10 });
  });

  it("never wraps a chip, the space beside a mention, or literal text", () => {
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
    const { editor } = mount("hi");
    select(editor, 2);
    clipboardEvent(editor, "paste", new FakeClipboard({ "text/plain": "@README.md" }));
    expect(docOf(editor)).toBe("hi @README.md ");
  });

  it("pastes verbatim inside code", () => {
    const value = "```\n\n```";
    const { editor } = mount(value);
    select(editor, 4);
    clipboardEvent(editor, "paste", new FakeClipboard({ "text/plain": "@README.md" }));
    expect(docOf(editor)).toBe("```\n@README.md\n```");
  });

  it("keeps a path continuing an @ query literal, so file search sees it as typed", () => {
    const { editor } = mount("open @src/");
    select(editor, 10);
    clipboardEvent(editor, "paste", new FakeClipboard({ "text/plain": "__init__.py" }));
    expect(docOf(editor)).toBe("open @src/__init__.py");
  });

  it("imports a structured paste's records and rewrites their ids, as one undo step", () => {
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
    const onCommandKeyDown = vi.fn(() => false);
    const { editor } = mount("- one", { host: { onCommandKeyDown } });
    editor.view.focus();
    select(editor, 5);
    press(editor, "Enter");
    expect(onCommandKeyDown).toHaveBeenCalledWith("Enter", expect.anything(), true);
    expect(docOf(editor)).toBe("- one\n- ");
  });

  it("makes a new line on an unclaimed Enter in plain mode", () => {
    const onCommandKeyDown = vi.fn(() => false);
    const { editor } = mount("- one", { mode: "plain", host: { onCommandKeyDown } });
    editor.view.focus();
    select(editor, 5);
    press(editor, "Enter");
    expect(onCommandKeyDown).toHaveBeenCalledWith("Enter", expect.anything(), false);
    expect(docOf(editor)).toBe("- one\n");
  });

  it("keeps Enter and Tab inside code for the code", () => {
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
    const { editor } = mount("hello", { host: { onCommandKeyDown: () => false } });
    editor.view.focus();
    select(editor, 5);
    const event = press(editor, "Tab");
    expect(event.defaultPrevented).toBe(false);
    expect(docOf(editor)).toBe("hello");
  });

  it("swallows Enter while an IME composes", () => {
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

describe("visual edges", () => {
  it("is never on the edge across a hard line break, and always in an empty prompt", () => {
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

  it("cannot change a citation while disabled", () => {
    const value = `ask ${source} `;
    const { editor, registry, view } = mount(value, { disabled: true });
    const entry = registry.entryAt(view, 4);
    expect(editor.saveCitationComment(entry!.dom, "why?")).toBe(false);
    expect(docOf(editor)).toBe(value);
  });
});
