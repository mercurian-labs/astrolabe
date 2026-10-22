import { describe, expect, it, vi } from "vite-plus/test";

import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { DEFAULT_RESOLVED_TRIGGERS } from "@t3tools/shared/keybindingTriggers";

import type { CommandPaletteActionItem } from "~/components/CommandPalette.logic";
import { openBeside, startingArrangement, type Arrangement } from "~/panes/arrangement";
import type { PaneArrangementSnapshot, PaneTabs } from "~/panes/panesHost";
import { leaves } from "~/panes/tree";
import { appCommand } from "./commands";
import { exLineGroups, type ExLineContext } from "./exPalette";
import { chatTabsSlot, panesSlot } from "./handles";

const stops: Array<() => void> = [];
/** Undoes, as a test ends, the handles it registered and what it put on the page. */
function cleanup(): Disposable {
  return {
    [Symbol.dispose]() {
      for (const stop of stops.splice(0)) stop();
      document.body.replaceChildren();
    },
  };
}

const context = (overrides: Partial<ExLineContext> = {}): ExLineContext => {
  const origin = overrides.origin ?? null;
  return {
    origin,
    triggers: DEFAULT_RESOLVED_TRIGGERS,
    // The registry as the keyboard menu lends it, over the surfaces registered below.
    command: (id) =>
      appCommand(id, {
        section: null,
        chatTabs: chatTabsSlot.get(),
        panes: panesSlot.get(),
        sections: [],
        keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
        origin,
        openSearch: () => {},
        openFilePicker: () => {},
        openCommandLine: () => {},
        findDocument: () => {},
      }),
    leaderLabel: "Space",
    actionItems: [],
    setLine: () => {},
    threadItems: [],
    chatTabThreadIds: [],
    overviews: [],
    showWikis: () => {},
    ...overrides,
  };
};

/** The rows for a line, as the palette lists them. */
const rows = (line: string, overrides?: Partial<ExLineContext>) =>
  exLineGroups(line, context(overrides)).flatMap((group) => group.items);

async function run(line: string, overrides?: Partial<ExLineContext>) {
  const [first] = rows(line, overrides);
  if (first?.kind !== "action" || first.disabled) throw new Error(`nothing runs for :${line}`);
  await first.run();
}

/** Two panes side by side, the left one (two tabs) focused. */
function panes() {
  let arrangement: Arrangement = openBeside(
    { ...startingArrangement(), root: { type: "leaf", id: "p0", tabs: ["a", "b"], active: "b" } },
    "c",
    "p0",
    "right",
    { focus: false },
  );
  const closed: string[] = [];
  const element = document.body.appendChild(document.createElement("div"));
  stops.push(
    panesSlot.register({
      controller: {
        update: (change) => {
          arrangement = change(arrangement);
        },
        getSnapshot: (): PaneArrangementSnapshot => ({ arrangement, hostPaneId: null }),
        subscribe: () => () => {},
      },
      tabs: { close: (key: string) => void closed.push(key) } as unknown as PaneTabs,
      layoutKey: "wikis",
      element: () => element,
    }),
  );
  return { arrangement: () => arrangement, closed, element };
}

function thread(id: string, title: string): CommandPaletteActionItem {
  return {
    kind: "action",
    value: `thread:${id}`,
    searchTerms: [title],
    title,
    icon: null,
    run: vi.fn(async () => {}),
  };
}

describe("the palette's ex commands", () => {
  it("closes the focused pane's tab with :q where only panes are on screen", async () => {
    using _cleanup = cleanup();
    const { closed } = panes();
    await run("q");
    await run("quit!");
    expect(closed).toEqual(["b", "b"]);
  });

  it("closes the chat tab in front with :q, unless focus is in the panes beside it", async () => {
    using _cleanup = cleanup();
    const { closed, element } = panes();
    const close = vi.fn();
    stops.push(chatTabsSlot.register({ keys: ["x", "y"], activeKey: "y", select: vi.fn(), close }));
    await run("q");
    expect(close).toHaveBeenCalledWith("y");
    const inPanes = element.appendChild(document.createElement("button"));
    await run("q", { origin: { element: inPanes, view: null, write: null } });
    expect(closed).toEqual(["b"]);
  });

  it("splits the focused pane with :sp and :vs, and offers nothing to split without panes", async () => {
    using _cleanup = cleanup();
    expect(rows("vs")[0]?.disabled).toBe(true);
    const { arrangement } = panes();
    await run("sp");
    expect(leaves(arrangement().root)).toHaveLength(3);
    expect(rows("vsplit")[0]?.disabled).toBe(true);
  });

  it("writes through the editor it came from, else sends the composer on screen", async () => {
    using _cleanup = cleanup();
    const write = vi.fn();
    const view = {} as NonNullable<ExLineContext["origin"]>["view"];
    await run("w", { origin: { element: null, view, write: { label: "Save", run: write } } });
    expect(write).toHaveBeenCalledOnce();

    expect(rows("w")[0]).toMatchObject({ title: "Nothing to write here", disabled: true });
    document.body.innerHTML = '<form><div data-testid="composer-editor"></div></form>';
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")?.addEventListener("submit", submitted);
    expect(rows("w")[0]?.title).toBe("Send the draft");
    await run("w");
    expect(submitted).toHaveBeenCalledOnce();
  });

  it("switches threads by name with :b, open chat tabs first, and lists the open ones bare", () => {
    using _cleanup = cleanup();
    const threadItems = [thread("t1", "Release notes"), thread("t2", "Fix release script")];
    const titles = (line: string, chatTabThreadIds: string[]) =>
      rows(line, { threadItems, chatTabThreadIds }).map((item) => item.title);
    expect(titles("b release", [])).toEqual(["Release notes", "Fix release script"]);
    expect(titles("b release", ["t2"])).toEqual(["Fix release script", "Release notes"]);
    expect(titles("b", ["t2"])).toEqual(["Fix release script"]);
  });

  it("offers an editor's own commands to the editor, and says Vim's words elsewhere", () => {
    using _cleanup = cleanup();
    expect(rows("s/a/b/")[0]).toMatchObject({ title: "Not an editor command", disabled: true });
    expect(rows("noh")[0]).toMatchObject({ disabled: true });
    const view = {} as NonNullable<ExLineContext["origin"]>["view"];
    const origin = { element: null, view, write: null };
    expect(rows("%s/a/b/g", { origin })[0]).toMatchObject({ title: "Run in the editor" });
    expect(rows("noh", { origin })[0]?.title).toBe("Clear search highlight");
  });

  it("lists every command for a bare colon, with its alias or menu keys and its shortcut", () => {
    using _cleanup = cleanup();
    const listed = rows("");
    expect(listed.find((item) => item.value === "ex:tab.close")).toMatchObject({
      title: "Close tab",
      description: "q[uit]",
      shortcutCommand: "tab.close",
    });
    expect(listed.find((item) => item.value === "ex:sidebar.toggle")).toMatchObject({
      description: "Space s s",
    });
    expect(listed.find((item) => item.value === "ex:buffer.open")?.description).toBe(
      "b[uffer] name",
    );
  });

  it("puts an argument command's name on the line, and lists upstream's actions beside", async () => {
    using _cleanup = cleanup();
    const setLine = vi.fn();
    const action = thread("theme", "Change theme");
    const listed = rows("", { setLine, actionItems: [action] });
    const buffer = listed.find((item) => item.value === "ex:buffer.open");
    if (buffer?.kind !== "action") throw new Error("no :b row");
    expect(buffer.keepOpen).toBe(true);
    await buffer.run();
    expect(setLine).toHaveBeenCalledWith("b ");
    expect(listed.at(-1)).toBe(action);
    // A line naming no command finds the commands and actions it matches.
    expect(rows("theme", { actionItems: [action] })).toEqual([action]);
    expect(rows("maximize").map((item) => item.title)).toEqual(["Maximize pane"]);
  });
});
