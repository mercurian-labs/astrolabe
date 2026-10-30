import { livePreview } from "@mercurian/editor/markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { OutlinePicker, openOutlinePicker } from "./OutlinePicker";

vi.mock(import("~/state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  return { ...(await original()), primaryServerKeybindingsAtom: Atom.make([]) as never };
});

/** An editor over `text`, `|` marking the cursor. */
function editorOf(text: string) {
  const view = new EditorView({
    state: EditorState.create({
      doc: text.replace("|", ""),
      selection: { anchor: text.indexOf("|") },
      extensions: livePreview(),
    }),
    parent: document.body,
  });
  return Object.assign(view, { [Symbol.dispose]: () => view.destroy() });
}

const row = (name: string) => page.getByRole("option", { name: new RegExp(`^${name}`) });

describe("the outline picker", () => {
  it("starts on the item around the cursor, and the arrows and Enter go on from there", async () => {
    using view = editorOf("# One\n## Two\ntext\n## Three\nhere|\n# Four\n");
    openOutlinePicker(view);
    await using _screen = await render(<OutlinePicker setOpen={() => {}} />);

    await expect.element(row("Three")).toHaveAttribute("data-active", "true");
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(row("Four")).toHaveAttribute("data-active", "true");
    await userEvent.keyboard("{Enter}");
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("Four"));
  });

  it("starts on the first item when the cursor is in none", async () => {
    using view = editorOf("intro|\n# One\n# Two\n");
    openOutlinePicker(view);
    await using _screen = await render(<OutlinePicker setOpen={() => {}} />);

    await expect.element(row("One")).toHaveAttribute("data-active", "true");
  });
});
