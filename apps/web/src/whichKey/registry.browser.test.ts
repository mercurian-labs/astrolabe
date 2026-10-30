import { setDiagnostics } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeEditing, softWrapOn } from "@mercurian/editor/code/editing";
import { gitChanges, gitHunks, setGitBase } from "@mercurian/editor/git";
import { diagnosticsUi } from "@mercurian/editor/lsp/diagnostics";
import { outline } from "@mercurian/editor/outline";
import { inFileSearch } from "@mercurian/editor/search";
import type { KeybindingCommand, ResolvedKeybindingTrigger } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { DEFAULT_RESOLVED_TRIGGERS } from "@t3tools/shared/keybindingTriggers";
import { describe, expect, it, vi } from "vite-plus/test";

import { isOutlineEditorFocused } from "~/lib/editorFocus";
import { focusPane, openBeside, startingArrangement, type Arrangement } from "~/panes/arrangement";
import { useMaximizedPaneStore } from "~/panes/maximize";
import type { PaneArrangementSnapshot, PaneTabs } from "~/panes/panesHost";
import { leaves } from "~/panes/tree";
import { diffBaseControl, type FileDiffBase } from "~/components/repositories/fileDiffBase";
import { appCommand, cycleKey, fullScreenState, type AppCommandContext } from "./commands";
import type { PanesHandle } from "./handles";
import {
  CHORD,
  NOT_HERE,
  keyLabels,
  pressWhichKey,
  openWhichKey,
  type WhichKeyGroup,
} from "./menu";
import { whichKeyRoot } from "./registry";

const stops: Array<() => void> = [];
/** Undoes, as a test ends, a maximized pane and the handles it registered. */
function cleanup(): Disposable {
  return {
    [Symbol.dispose]() {
      useMaximizedPaneStore.getState().restore();
      for (const stop of stops.splice(0)) stop();
    },
  };
}

/** Presses `keys` from the root; what ran, or the note the last key left. */
function press(root: WhichKeyGroup, keys: string[]) {
  let state = openWhichKey("chord");
  for (const key of keys) {
    const step = pressWhichKey(state, root, key);
    if (step.run) {
      step.run();
      return null;
    }
    if (!step.state) return null;
    state = step.state;
  }
  return state.note;
}

/** The commands upstream's shortcut handlers saw, pressed through their shortcuts. */
function pressedCommands() {
  const pressed: string[] = [];
  const onKeyDown = (event: KeyboardEvent) => {
    const binding = DEFAULT_RESOLVED_KEYBINDINGS.findLast(
      (candidate) =>
        candidate.shortcut.key === event.key &&
        candidate.shortcut.shiftKey === event.shiftKey &&
        candidate.shortcut.altKey === event.altKey &&
        !candidate.whenAst,
    );
    if (binding) pressed.push(binding.command);
  };
  window.addEventListener("keydown", onKeyDown);
  stops.push(() => window.removeEventListener("keydown", onKeyDown));
  return pressed;
}

function context(
  overrides: Partial<AppCommandContext> = {},
  triggers: ReadonlyArray<ResolvedKeybindingTrigger> = DEFAULT_RESOLVED_TRIGGERS,
) {
  const ran: string[] = [];
  const note = (name: string) => () => void ran.push(name);
  const value: AppCommandContext = {
    section: null,
    chatTabs: null,
    panes: null,
    sections: ["threads", "wikis", "pull-requests", "usage", "settings"].map((id) => ({
      id,
      label: id,
      open: note(`open ${id}`),
    })),
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    origin: null,
    openSearch: note("search"),
    openFilePicker: note("file picker"),
    openCommandLine: note("command line"),
    findDocument: note("find document"),
    ...overrides,
  };
  const root = whichKeyRoot(triggers, (id: KeybindingCommand) => appCommand(id, value));
  /** The same context, acting from `origin`. */
  const actingFrom = (origin: AppCommandContext["origin"]): AppCommandContext => ({
    ...value,
    origin,
  });
  return { root, ran, actingFrom };
}

/** Two panes side by side, the second focused. */
function twoPanes(): PanesHandle & { arrangement: () => Arrangement; closed: string[] } {
  let snapshot: PaneArrangementSnapshot = {
    arrangement: openBeside(
      { ...startingArrangement(), root: { type: "leaf", id: "p0", tabs: ["a", "b"], active: "a" } },
      "c",
      "p0",
      "right",
    ),
    hostPaneId: null,
  };
  const closed: string[] = [];
  return {
    controller: {
      update: (change) => {
        snapshot = { ...snapshot, arrangement: change(snapshot.arrangement) };
      },
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
    tabs: { close: (key: string) => void closed.push(key) } as unknown as PaneTabs,
    layoutKey: "thread",
    element: () => null,
    arrangement: () => snapshot.arrangement,
    closed,
  };
}

const menuKeys = (
  command: KeybindingCommand,
  ...sequence: string[]
): ResolvedKeybindingTrigger => ({
  kind: "menu",
  command,
  sequence,
});

describe("the keyboard menu built from the menu rules", () => {
  it("has the default rows at its root, the built-in groups named", () => {
    using _cleanup = cleanup();
    const { root } = context();
    expect(root.items.map((item) => [item.keys.join(" "), item.label])).toEqual([
      [":", "Command palette"],
      [`/ ${CHORD}`, "Search"],
      ["n", "New thread"],
      ["f", "Find file"],
      ["ArrowLeft h", "Focus left"],
      ["ArrowDown j", "Focus down"],
      ["ArrowUp k", "Focus up"],
      ["ArrowRight l", "Focus right"],
      ["d", "Scroll down"],
      ["u", "Scroll up"],
      ["g", "Go to"],
      ["t", "Tabs"],
      ["p", "Panes"],
      ["s", "Sidebar"],
      ["w", "Wikis"],
      ["e", "Editor"],
      ["r", "Repositories"],
      [",", "settings"],
    ]);
    // Only the focus moves and the scrolls repeat, there and nowhere in the groups.
    const repeatable = (group: WhichKeyGroup): string[] =>
      group.items.flatMap((item) =>
        item.group ? repeatable(item.group) : item.repeatable ? [item.keys[0]] : [],
      );
    expect(repeatable(root)).toEqual(["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight", "d", "u"]);
    // Each focus move's row reads its arrow, then its letter.
    expect(
      keyLabels(
        root.items.find((item) => item.label === "Focus left")!,
        "⌘K",
      ),
    ).toEqual(["←", "h"]);
  });

  it("names a prefix a user made by its count, and shares a row between keys for one command", () => {
    using _cleanup = cleanup();
    const { root } = context({}, [
      ...DEFAULT_RESOLVED_TRIGGERS,
      menuKeys("chat.new", "x", "n"),
      menuKeys("chat.newLocal", "x", "l"),
      menuKeys("chat.new", "x", "o"),
      menuKeys("commandPalette.toggle", "?"),
    ]);
    const group = root.items.find((item) => item.keys[0] === "x");
    expect(group?.label).toBe("+2");
    expect(group?.group?.items.map((item) => item.keys)).toEqual([["n", "o"], ["l"]]);
    expect(
      keyLabels(
        root.items.find((item) => item.label === "Search")!,
        "⌘K",
      ),
    ).toEqual(["/", "?"]);
  });

  it("makes a key that leads on a group, over a shorter sequence ending on it", () => {
    using _cleanup = cleanup();
    const { root } = context({}, [menuKeys("chat.new", "g"), menuKeys("section.wikis", "g", "w")]);
    expect(root.items.find((item) => item.keys[0] === "g")?.group?.items).toHaveLength(1);
    // Without a rule for Search, the chord still opens it, and shows on its row.
    expect(root.items.at(-1)?.keys).toEqual([CHORD]);
    expect(keyLabels(root.items.at(-1)!, "⌘K")).toEqual(["⌘K"]);
  });

  it("opens the Command Palette from :, Search from / and the chord's second press, and f", () => {
    using _cleanup = cleanup();
    const { root, ran } = context();
    press(root, [":"]);
    press(root, ["/"]);
    press(root, [CHORD]);
    // The file picker has no default shortcut (mod+p is the Command Palette's), yet opens.
    press(root, ["f"]);
    expect(ran).toEqual(["command line", "search", "search", "file picker"]);
  });

  it("runs upstream commands through their shortcuts, and greys out one without a shortcut", () => {
    using _cleanup = cleanup();
    const pressed = pressedCommands();
    const { root } = context({
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS.filter(
        (binding) => binding.command !== "view.reopenClosed",
      ),
    });
    press(root, ["s", "s"]);
    expect(press(root, ["t", "r"])).toBe(NOT_HERE);
    expect(pressed).toEqual(["sidebar.toggle"]);
  });

  it("goes to each section as the icon rail opens it, and opens Wikis' finder", () => {
    using _cleanup = cleanup();
    const { root, ran } = context();
    for (const key of ["t", "w", "p", "u", "s"]) press(root, ["g", key]);
    press(root, [","]);
    press(root, ["w", "w"]);
    press(root, ["w", "f"]);
    expect(ran).toEqual([
      "open threads",
      "open wikis",
      "open pull-requests",
      "open usage",
      "open settings",
      "open settings",
      "open wikis",
      "find document",
    ]);
  });

  it("adds through the sidebar section's title row while one is mounted", () => {
    using _cleanup = cleanup();
    const newItem = vi.fn();
    const { root } = context({
      section: { newItem, newItemLabel: "New document", newItemDisabled: false },
    });
    expect(root.items.find((item) => item.keys[0] === "n")?.label).toBe("New document");
    press(root, ["n"]);
    expect(newItem).toHaveBeenCalledOnce();
  });

  it("steps, closes, and reopens chat tabs", () => {
    using _cleanup = cleanup();
    const pressed = pressedCommands();
    const select = vi.fn();
    const close = vi.fn();
    const { root } = context({
      chatTabs: { keys: ["a", "b", "c"], activeKey: "c", select, close },
    });
    press(root, ["t", "]"]);
    press(root, ["t", "["]);
    press(root, ["t", "c"]);
    press(root, ["t", "r"]);
    expect(select.mock.calls).toEqual([["a"], ["b"]]);
    expect(close).toHaveBeenCalledWith("c");
    expect(pressed).toEqual(["view.reopenClosed"]);
    // One tab has nowhere to step.
    expect(
      press(context({ chatTabs: { keys: ["a"], activeKey: "a", select, close } }).root, ["t", "]"]),
    ).toBe(NOT_HERE);
    expect(cycleKey(["a", "b"], null, -1)).toBe("b");
  });

  it("splits, maximizes, and closes the focused pane on screen", () => {
    using _cleanup = cleanup();
    const panes = twoPanes();
    const focusedId = () => panes.arrangement().focused;
    expect(leaves(panes.arrangement().root)).toHaveLength(2);

    // The focused pane holds one tab: nothing to split off.
    expect(press(context({ panes }).root, ["p", "v"])).toBe(NOT_HERE);
    panes.controller.update((arrangement) => focusPane(arrangement, "p0"));
    press(context({ panes }).root, ["p", "v"]);
    expect(leaves(panes.arrangement().root)).toHaveLength(3);

    press(context({ panes }).root, ["p", "m"]);
    expect(useMaximizedPaneStore.getState().maximized).toEqual({
      layoutKey: "thread",
      paneId: focusedId(),
    });
    expect(
      context({ panes }).root.items.find((item) => item.keys[0] === "p")?.group?.items,
    ).toContainEqual(expect.objectContaining({ keys: ["m"], label: "Restore pane" }));

    press(context({ panes }).root, ["p", "c"]);
    expect(panes.closed).toEqual(
      leaves(panes.arrangement().root).find((leaf) => leaf.id === focusedId())?.tabs,
    );
    // Without panes on screen there is nothing to act on.
    expect(press(context().root, ["p", "s"])).toBe(NOT_HERE);
  });

  it("takes the focused pane full screen, maximizing the right panel too, and back", () => {
    using _cleanup = cleanup();
    const panes = twoPanes();
    let panelMaximized = false;
    const inPanel = () => ({
      ...panes,
      panel: {
        maximized: panelMaximized,
        setMaximized: (next: boolean) => void (panelMaximized = next),
      },
    });
    const label = () =>
      context({ panes: inPanel() })
        .root.items.find((item) => item.keys[0] === "p")
        ?.group?.items.find((item) => item.keys[0] === "f")?.label;
    expect(label()).toBe("Full screen pane");
    press(context({ panes: inPanel() }).root, ["p", "f"]);
    expect(useMaximizedPaneStore.getState().maximized?.paneId).toBe(panes.arrangement().focused);
    expect(panelMaximized).toBe(true);
    expect(label()).toBe("Exit full screen");
    press(context({ panes: inPanel() }).root, ["p", "f"]);
    expect(useMaximizedPaneStore.getState().maximized).toBeNull();
    expect(panelMaximized).toBe(false);
  });

  it("toggles the right panel from p r only with a chat on screen", () => {
    using _cleanup = cleanup();
    const pressed = pressedCommands();
    const select = vi.fn();
    const close = vi.fn();
    expect(press(context().root, ["p", "r"])).toBe(NOT_HERE);
    press(context({ chatTabs: { keys: ["a"], activeKey: "a", select, close } }).root, ["p", "r"]);
    expect(pressed).toEqual(["rightPanel.toggle"]);
  });
});

describe("Find in editor", () => {
  /** An editor on the page, inside `parent` (the body when not given), gone as the test ends. */
  function editor(extensions: Extension, parent: HTMLElement = document.body) {
    const view = new EditorView({
      parent: parent.appendChild(document.createElement("div")),
      state: EditorState.create({ doc: "find me", extensions }),
    });
    stops.push(() => {
      view.destroy();
      view.dom.parentElement?.remove();
    });
    return view;
  }

  /** Where a key pressed in `view` comes from, as the menu's chord reports it. */
  const keyIn = (view: EditorView) => ({ element: view.contentDOM, view: null, write: null });

  it("opens the find bar of the editor the menu was opened from, with e f", async () => {
    using _cleanup = cleanup();
    const view = editor(inFileSearch());
    view.focus();
    const { root } = context({ origin: keyIn(view) });
    expect(press(root, ["e", "f"])).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(view.dom.querySelector(".cm-search input[name=search]")),
    );
  });

  it("finds in the note around a table cell's editor, and is faint where no editor has a bar", () => {
    using _cleanup = cleanup();
    const note = editor(inFileSearch());
    const cell = editor([], note.dom);
    expect(appCommand("search.find", context().actingFrom(keyIn(cell))).disabled).toBe(false);

    // The composer: an editor with no find bar, where mod+f stays thread find.
    const composer = editor([]);
    const faint = appCommand("search.find", context().actingFrom(keyIn(composer)));
    expect(faint).toMatchObject({ label: "No editor to find in", disabled: true });
    expect(appCommand("search.find", context().actingFrom(null)).disabled).toBe(true);
  });
});

describe("a code file's changes from the keyboard menu", () => {
  /** A code editor showing changes against `base`, gone as the test ends. */
  function codeEditor(base: string | null, doc: string, extensions: Extension = []) {
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement("div")),
      state: EditorState.create({ doc, extensions: [gitChanges(), extensions] }),
    });
    view.dispatch({ effects: setGitBase(base) });
    stops.push(() => {
      view.destroy();
      view.dom.parentElement?.remove();
    });
    return view;
  }

  const keyIn = (view: EditorView) => ({ element: view.contentDOM, view: null, write: null });

  it("steps to the next change and restores it, with e n and e r", async () => {
    using _cleanup = cleanup();
    const view = codeEditor("a\nb\nc\nd\n", "a\nB\nc\nd\n");
    view.focus();
    const { root } = context({ origin: keyIn(view) });
    press(root, ["e", "n"]);
    await vi.waitFor(() =>
      expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2),
    );
    press(root, ["e", "r"]);
    await vi.waitFor(() => expect(gitHunks(view.state)).toEqual([]));
    expect(view.state.doc.toString()).toBe("a\nb\nc\nd\n");
  });

  it("is faint where the editor shows no changes", () => {
    using _cleanup = cleanup();
    const plain = codeEditor(null, "a\n");
    const faint = appCommand("hunk.next", context().actingFrom(keyIn(plain)));
    expect(faint).toMatchObject({ label: "No changes here", disabled: true });
    expect(appCommand("hunk.restore", context().actingFrom(null)).disabled).toBe(true);
  });

  it("switches a file between HEAD and since this turn with e b, faint without a turn", () => {
    using _cleanup = cleanup();
    let base: FileDiffBase = "turn";
    let turnAvailable = true;
    const view = codeEditor("a\n", "b\n", [
      diffBaseControl.of({
        current: () => ({ base, turnAvailable }),
        toggle: () => {
          base = base === "turn" ? "head" : "turn";
        },
      }),
    ]);
    const switchBase = () => appCommand("hunk.toggleBase", context().actingFrom(keyIn(view)));
    expect(switchBase().label).toBe("Compare with HEAD");
    press(context({ origin: keyIn(view) }).root, ["e", "b"]);
    expect(base).toBe("head");
    expect(switchBase().label).toBe("Compare since this turn");

    turnAvailable = false;
    expect(switchBase()).toMatchObject({ label: "No turn changed this file", disabled: true });
    expect(appCommand("hunk.toggleBase", context().actingFrom(null)).disabled).toBe(true);
  });
});

describe("Go to symbol", () => {
  function editor(extensions: Extension, parent: HTMLElement = document.body) {
    const view = new EditorView({
      parent: parent.appendChild(document.createElement("div")),
      state: EditorState.create({ doc: "# Title", extensions }),
    });
    stops.push(() => {
      view.destroy();
      view.dom.parentElement?.remove();
    });
    return view;
  }
  const keyIn = (view: EditorView) => ({ element: view.contentDOM, view: null, write: null });

  it("acts on the file or note the key came from, through a table cell's editor too", () => {
    using _cleanup = cleanup();
    const note = editor(outline());
    const cell = editor([], note.dom);
    expect(appCommand("outline.open", context().actingFrom(keyIn(note)))).toMatchObject({
      label: "Go to symbol",
      disabled: false,
    });
    expect(appCommand("outline.open", context().actingFrom(keyIn(cell))).disabled).toBe(false);

    // The composer has no outline, so mod+shift+o stays a new thread there.
    const composer = editor([]);
    expect(appCommand("outline.open", context().actingFrom(keyIn(composer)))).toMatchObject({
      label: "No file to outline",
      disabled: true,
    });
    composer.focus();
    expect(isOutlineEditorFocused()).toBe(false);
    cell.focus();
    expect(isOutlineEditorFocused()).toBe(true);
  });
});

describe("a code file's editing commands", () => {
  function editor(doc: string, extensions: Extension) {
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement("div")),
      state: EditorState.create({ doc, extensions }),
    });
    stops.push(() => {
      view.destroy();
      view.dom.parentElement?.remove();
    });
    return view;
  }
  const keyIn = (view: EditorView) => ({ element: view.contentDOM, view: null, write: null });

  it("lists them in the Editor group, and runs one in the code file the menu came from", async () => {
    using _cleanup = cleanup();
    const view = editor("pear\napple\nfig", codeEditing());
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.focus();
    const { root } = context({ origin: keyIn(view) });
    const group = root.items.find((item) => item.label === "Editor")?.group;
    expect(group?.items.map((item) => [item.keys.join(" "), item.label])).toEqual([
      // This editor has no find bar.
      ["f", "No editor to find in"],
      // Nor any changes to show.
      ["n", "No changes here"],
      ["p", "No changes here"],
      ["t", "No changes here"],
      ["a", "No changes here"],
      ["r", "No changes here"],
      ["b", "No turn changed this file"],
      ["o", "No file to outline"],
      // Nor a language server's problems.
      [".", "No problems shown here"],
      [",", "No problems shown here"],
      ["c", "Toggle comment"],
      ["d", "Duplicate selection"],
      ["j", "Join lines"],
      ["s", "Sort lines"],
      ["u", "Upper case"],
      ["l", "Lower case"],
      ["w", "Wrap lines"],
      ["[", "Fold all"],
      ["]", "Unfold all"],
    ]);
    expect(press(root, ["e", "s"])).toBeNull();
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("apple\nfig\npear"));

    press(root, ["e", "w"]);
    await vi.waitFor(() => expect(softWrapOn(view.state)).toBe(true));
    expect(appCommand("code.toggleSoftWrap", context().actingFrom(keyIn(view))).label).toBe(
      "Stop wrapping lines",
    );
  });

  it("steps to the next problem in a file that shows them", async () => {
    using _cleanup = cleanup();
    const view = editor(
      "const a = 1;\nconst b = 2;\n",
      diagnosticsUi({ keys: { next: [], previous: [] } }),
    );
    view.dispatch(
      setDiagnostics(view.state, [{ from: 19, to: 20, severity: "error", message: "b is unused" }]),
    );
    view.focus();
    const { root } = context({ origin: keyIn(view) });
    expect(appCommand("diagnostic.next", context().actingFrom(keyIn(view)))).toMatchObject({
      label: "Next problem",
      disabled: false,
    });
    press(root, ["e", "."]);
    await vi.waitFor(() => expect(view.state.selection.main.from).toBe(19));
  });

  it("is faint outside a code file, and for edits in one that cannot be edited", () => {
    using _cleanup = cleanup();
    const note = editor("a note", []);
    const notHere = appCommand("code.sortLines", context().actingFrom(keyIn(note)));
    expect(notHere).toMatchObject({ label: "Sort lines", disabled: true });

    const readOnly = editor("b\na", [codeEditing(), EditorState.readOnly.of(true)]);
    const from = context().actingFrom(keyIn(readOnly));
    expect(appCommand("code.sortLines", from).disabled).toBe(true);
    expect(appCommand("code.foldAll", from).disabled).toBe(false);
    expect(appCommand("code.toggleSoftWrap", from).disabled).toBe(false);
  });
});

describe("full screen for the focused pane", () => {
  it("maximizes what does not fill yet, and restores both once full", () => {
    using _cleanup = cleanup();
    // A right panel's lone pane: only the panel maximizes, and back.
    expect(fullScreenState({ alone: true, paneMaximized: false, panelMaximized: false })).toEqual({
      full: false,
      change: { pane: false, panel: true },
    });
    expect(fullScreenState({ alone: true, paneMaximized: false, panelMaximized: true })).toEqual({
      full: true,
      change: { pane: false, panel: false },
    });
    // A pane among others, with the panel maximized by hand: the pane maximizes, the panel stays.
    expect(fullScreenState({ alone: false, paneMaximized: false, panelMaximized: true })).toEqual({
      full: false,
      change: { pane: true, panel: null },
    });
    expect(fullScreenState({ alone: false, paneMaximized: true, panelMaximized: true })).toEqual({
      full: true,
      change: { pane: true, panel: false },
    });
  });

  it("is maximizing the pane in the Wikis area, with nothing to do for a lone pane", () => {
    using _cleanup = cleanup();
    expect(fullScreenState({ alone: false, paneMaximized: false, panelMaximized: null })).toEqual({
      full: false,
      change: { pane: true, panel: null },
    });
    expect(
      fullScreenState({ alone: false, paneMaximized: true, panelMaximized: null }).change,
    ).toEqual({ pane: true, panel: null });
    expect(
      fullScreenState({ alone: true, paneMaximized: false, panelMaximized: null }).change,
    ).toBeNull();
  });
});
