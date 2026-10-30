import { flushSync } from "react-dom";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { dispatchCommandPalette, useCommandPaletteStore } from "../commandPaletteStore";
import { CommandPalette } from "./CommandPalette";

function setup() {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
}

describe("CommandPalette open intents", () => {
  it("opens New thread in... with focus in the search input, not the Back button", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
  });

  it("opens a search intent with its query in the focused input", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "acme" });

    const input = page.getByPlaceholder("Search threads, documents, and projects...");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue("acme");
  });

  it("leaves focus where the action that closed it put it", async () => {
    setup();
    await using screen = await render(
      <CommandPalette>
        <button type="button">Rail</button>
        <textarea aria-label="Editor" />
      </CommandPalette>,
    );
    const rail = screen.getByRole("button", { name: "Rail" }).element() as HTMLElement;
    const editor = screen.getByRole("textbox", { name: "Editor" }).element() as HTMLElement;
    rail.focus();
    openCommandPalette({ query: "" });
    await expect.element(page.getByTestId("command-palette")).toBeInTheDocument();

    // As opening a search result does: close, then focus the editor it opened while the palette
    // is still on its way out.
    flushSync(() => dispatchCommandPalette({ _tag: "SetOpen", open: false }));
    editor.focus();
    expect(document.activeElement).toBe(editor);
    await expect.element(page.getByTestId("command-palette")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(editor);
  });
});
