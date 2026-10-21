import { afterEach, describe, expect, it } from "vite-plus/test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { AtlasEditor } from "./editor.tsx";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mounted: { root: Root; host: HTMLElement }[] = [];

afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

async function mountEditor(text: Y.Text) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () =>
    root.render(<AtlasEditor text={text} awareness={new Awareness(text.doc ?? new Y.Doc())} />),
  );
  const editor = host.querySelector<HTMLElement>(".cm-editor");
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (!view) throw new Error("AtlasEditor did not mount a view");
  return { host, view };
}

function undo(view: EditorView) {
  const mac = /Mac/.test(navigator.platform);
  const event = new KeyboardEvent("keydown", {
    key: "z",
    keyCode: 90,
    metaKey: mac,
    ctrlKey: !mac,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, "editor");
}

describe("AtlasEditor", () => {
  it("gives a checkbox click its own Yjs undo step between two bursts of typing", async () => {
    const doc = new Y.Doc();
    const text = doc.getText("note");
    text.insert(0, "- [ ] task\n");
    const { host, view } = await mountEditor(text);
    const type = (insert: string) =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert },
        selection: { anchor: view.state.doc.length + insert.length },
        userEvent: "input.type",
      });

    // All three actions land well inside Yjs's capture window.
    type("a");
    host
      .querySelector("input.cm-md-checkbox")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    type("b");
    expect(text.toString()).toBe("- [x] task\nab");

    expect(undo(view)).toBe(true);
    expect(text.toString()).toBe("- [x] task\na");
    undo(view);
    expect(text.toString()).toBe("- [ ] task\na");
    undo(view);
    expect(text.toString()).toBe("- [ ] task\n");
    expect(view.state.doc.toString()).toBe("- [ ] task\n");
  });
});
