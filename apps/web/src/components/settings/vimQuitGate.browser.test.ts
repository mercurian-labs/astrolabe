import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vimInsertMode } from "@mercurian/editor/vim";
import { describe, expect, it, vi } from "vite-plus/test";

import { isVimQuit, vimQuitGate } from "./vimQuitGate";

const views: EditorView[] = [];
/** Destroys a test's editors as it ends. */
function cleanup(): Disposable {
  return {
    [Symbol.dispose]() {
      for (const view of views.splice(0)) view.destroy();
      document.body.replaceChildren();
    },
  };
}

function gate() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ extensions: vimQuitGate({ onConfirm, onCancel }) }),
  });
  views.push(view);
  view.focus();
  return { view, onConfirm, onCancel };
}

function press(view: EditorView, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return event;
}

/** Opens Vim's prompt with `key` (`:` or `/`) and enters `value`, or presses Escape on it. */
function prompt(view: EditorView, key: string, value: string, finish: "Enter" | "Escape") {
  press(view, key);
  const input = view.dom.querySelector<HTMLInputElement>(".cm-panels input");
  if (!input) throw new Error(`no prompt for ${key}`);
  input.value = value;
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: finish,
      keyCode: finish === "Enter" ? 13 : 27,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("isVimQuit", () => {
  it("accepts :q as Vim reads it and nothing else", () => {
    using _cleanup = cleanup();
    for (const input of ["q", "qu", "qui", "quit", "q!", "quit!", " q ", ":q"]) {
      expect(isVimQuit(input), input).toBe(true);
    }
    for (const input of ["w", "wq", "x", "qa", "quitt", "q q", "s/a/b/"]) {
      expect(isVimQuit(input), input).toBe(false);
    }
  });
});

describe("the :q gate", () => {
  it("confirms on :q, once", () => {
    using _cleanup = cleanup();
    const { view, onConfirm, onCancel } = gate();
    prompt(view, ":", "q", "Enter");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Settled: nothing after it decides again.
    press(view, "Escape");
    prompt(view, ":", "w", "Enter");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("backs out on any other ex command", () => {
    using _cleanup = cleanup();
    const { view, onConfirm, onCancel } = gate();
    prompt(view, ":", "w", "Enter");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("backs out on Escape in normal mode, and only there", () => {
    using _cleanup = cleanup();
    const { view, onCancel } = gate();
    press(view, "i");
    expect(vimInsertMode(view)).toBe(true);
    // Escape in insert mode is Vim's way to normal mode.
    press(view, "Escape");
    expect(vimInsertMode(view)).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
    const event = press(view, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("decides nothing on a search, an empty ex line, or Escape on the ex line", () => {
    using _cleanup = cleanup();
    const { view, onConfirm, onCancel } = gate();
    prompt(view, "/", "q", "Enter");
    prompt(view, ":", "", "Enter");
    prompt(view, ":", "w", "Escape");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps to one line", () => {
    using _cleanup = cleanup();
    const { view } = gate();
    press(view, "i");
    view.dispatch(view.state.replaceSelection("q"));
    press(view, "Enter");
    view.dispatch(view.state.replaceSelection("\n"));
    expect(view.state.doc.toString()).toBe("q");
  });
});
