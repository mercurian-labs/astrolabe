import { afterEach, describe, expect, it } from "vite-plus/test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { cursorCharRight } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import {
  acceptAgentChange,
  acceptTurn,
  agentChangeBar,
  agentChanges,
  agentInsertions,
  clearAgentChanges,
  dismissAgentDeletion,
  followAgentChanges,
  nextAgentChange,
  observeAgentChanges,
  previousAgentChange,
  readAgentChanges,
  restoreAgentDeletion,
  revealAgentChanges,
  revertAgentChange,
  revertTurn,
  placementMargin,
  visibleIn,
  type ClientInsertion,
} from "./agentChanges.ts";
import { declareAgent, endAgentTurn, parkAgentCursor } from "./agentAwareness.ts";
import { applyFileText } from "../bridge/fileText.ts";
import { AtlasEditor, isolatedUndoSteps } from "../editor.tsx";
import { markFocused } from "../markdown/reveal.ts";
import { finishParse } from "../markdown/testSupport.ts";
import { livePreview } from "../markdown/livePreview.ts";

const REMOTE = Symbol("remote");

function peer(clientID: number) {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  return { doc, text: doc.getText("note") };
}

/** Relays every update between the two docs, the way a network provider would. */
function connect(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), REMOTE);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), REMOTE);
  a.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(b, update, REMOTE);
  });
  b.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(a, update, REMOTE);
  });
}

/** Collects `agentInsertions` for every change `text` observes. */
function recordInsertions(text: Y.Text, agentClients: ReadonlySet<number>) {
  const seen: ClientInsertion[][] = [];
  text.observe((event) => seen.push(agentInsertions(event, agentClients)));
  return seen;
}

describe("agentInsertions", () => {
  it("marks text inserted by an agent client, at its index after the change", () => {
    const user = peer(1);
    const agent = peer(2);
    user.text.insert(0, "hello world");
    connect(user.doc, agent.doc);
    const seen = recordInsertions(user.text, new Set([2]));

    agent.text.insert(6, "big ");

    expect(user.text.toString()).toBe("hello big world");
    expect(seen).toEqual([[{ from: 6, to: 10, client: 2 }]]);
  });

  it("does not mark text inserted by the user's own client", () => {
    const user = peer(1);
    const agent = peer(2);
    connect(user.doc, agent.doc);
    const seen = recordInsertions(user.text, new Set([2]));

    user.text.insert(0, "typed by the user");

    expect(seen).toEqual([[]]);
  });

  it("separates an agent's runs around text it kept", () => {
    const user = peer(1);
    const agent = peer(2);
    user.text.insert(0, "a-b");
    connect(user.doc, agent.doc);
    const seen = recordInsertions(user.text, new Set([2]));

    agent.doc.transact(() => {
      agent.text.insert(3, "!!");
      agent.text.insert(0, ">>");
    });

    expect(user.text.toString()).toBe(">>a-b!!");
    expect(seen).toEqual([
      [
        { from: 0, to: 2, client: 2 },
        { from: 5, to: 7, client: 2 },
      ],
    ]);
  });
});

describe("agentChanges", () => {
  let view: EditorView | null = null;
  const awarenesses: Awareness[] = [];

  afterEach(() => {
    view?.destroy();
    view = null;
    for (const awareness of awarenesses.splice(0)) awareness.destroy();
    document.body.innerHTML = "";
  });

  function mount() {
    const user = peer(1);
    const agent = peer(2);
    user.text.insert(0, "plain text\n");
    const userAwareness = new Awareness(user.doc);
    const agentAwareness = new Awareness(agent.doc);
    awarenesses.push(userAwareness, agentAwareness);
    declareAgent(agentAwareness, { name: "Agent · turn 1", color: "#7c3aed", turnId: "turn-1" });
    // The user's editor only learns which clients are agents through awareness.
    applyAwarenessUpdate(
      userAwareness,
      encodeAwarenessUpdate(agentAwareness, [agent.doc.clientID]),
      REMOTE,
    );
    connect(user.doc, agent.doc);
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: user.text.toString(),
        extensions: [yCollab(user.text, userAwareness), agentChanges(user.text, userAwareness)],
      }),
    });
    return { view, user, agent };
  }

  function highlighted(editor: EditorView) {
    return [...editor.dom.querySelectorAll(".atlas-agent-change")].map((node) => node.textContent);
  }

  it("highlights what the agent inserted", () => {
    const { view: editor, agent } = mount();

    agent.text.insert(agent.text.length, "agent line");

    expect(editor.state.doc.toString()).toBe("plain text\nagent line");
    expect(highlighted(editor)).toEqual(["agent line"]);
  });

  it("does not highlight the user's typing, even inside an agent insertion", () => {
    const { view: editor, agent } = mount();
    agent.text.insert(agent.text.length, "agentline");

    editor.dispatch({ changes: { from: 0, insert: "mine " } });
    const inside = editor.state.doc.toString().indexOf("line");
    editor.dispatch({ changes: { from: inside, insert: " user " } });

    expect(editor.state.doc.toString()).toBe("mine plain text\nagent user line");
    expect(highlighted(editor)).toEqual(["agent", "line"]);
  });
});

describe("agent change log", () => {
  let view: EditorView | null = null;
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    view?.destroy();
    view = null;
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.innerHTML = "";
  });

  const TURN = { turnId: "turn-1", name: "Agent · turn 1", color: "#7c3aed" };

  /**
   * The user's editor as `AtlasEditor` wires it (Yjs undo, isolated steps, the change bar),
   * and an agent peer that writes files through the bridge with the log on.
   */
  function session(initial: string, caret = 0, extra: Extension = [], parkedAt?: number) {
    const user = peer(1);
    const agent = peer(2);
    user.text.insert(0, initial);
    const userAwareness = new Awareness(user.doc);
    const agentAwareness = new Awareness(agent.doc);
    const undoManager = new Y.UndoManager(user.text);
    cleanups.push(() => {
      userAwareness.destroy();
      agentAwareness.destroy();
      undoManager.destroy();
    });
    const relayAwareness = () =>
      applyAwarenessUpdate(
        userAwareness,
        encodeAwarenessUpdate(agentAwareness, [agent.doc.clientID]),
        REMOTE,
      );
    declareAgent(agentAwareness, TURN);
    connect(user.doc, agent.doc);
    // An agent already at work when the editor mounts has its cursor parked somewhere.
    if (parkedAt !== undefined) parkAgentCursor(agentAwareness, agent.text, parkedAt);
    relayAwareness();
    const editor = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: user.text.toString(),
        selection: { anchor: caret },
        extensions: [
          yCollab(user.text, userAwareness, { undoManager }),
          isolatedUndoSteps(undoManager),
          agentChanges(user.text, userAwareness),
          agentChangeBar(),
          extra,
        ],
      }),
    });
    view = editor;

    // The agent remembers the file text it last wrote, as the playground's agent does.
    let file = initial;
    const write = (next: string | ((file: string) => string)) => {
      const text = typeof next === "string" ? next : next(file);
      const end = applyFileText(agent.text, file, text, { log: TURN });
      file = text;
      return end;
    };
    const endTurn = () => {
      endAgentTurn(agentAwareness);
      relayAwareness();
    };
    const type = (at: number, insert: string) =>
      editor.dispatch({ changes: { from: at, insert }, userEvent: "input.type" });
    /** Parks the agent's cursor at `index` of its text, as an agent does before a write. */
    const moveAgentCursor = (index: number) => {
      parkAgentCursor(agentAwareness, agent.text, index);
      relayAwareness();
    };
    return {
      view: editor,
      user,
      agent,
      userAwareness,
      write,
      endTurn,
      type,
      moveAgentCursor,
      undoManager,
    };
  }

  function ghosts(editor: EditorView) {
    return [...editor.dom.querySelectorAll<HTMLElement>(".atlas-agent-ghost")];
  }

  function onlyGhost(editor: EditorView) {
    const found = ghosts(editor);
    expect(found).toHaveLength(1);
    const [ghost] = found;
    if (!ghost) throw new Error("no ghost");
    return ghost;
  }

  function highlighted(editor: EditorView) {
    return [...editor.dom.querySelectorAll(".atlas-agent-change")].map((node) => node.textContent);
  }

  function barCount(editor: EditorView) {
    return editor.dom.querySelector(".atlas-agent-bar-count")?.textContent ?? null;
  }

  function barButton(editor: EditorView, label: string) {
    const button = [...editor.dom.querySelectorAll<HTMLElement>(".atlas-agent-bar-button")].find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) throw new Error(`no ${label} button`);
    return button;
  }

  function popoverAction(label: string) {
    const action = [...document.querySelectorAll<HTMLElement>(".atlas-agent-ghost-action")].find(
      (candidate) => candidate.textContent === label,
    );
    if (!action) throw new Error(`no ${label} action`);
    return action;
  }

  function entryIds(doc: Y.Doc) {
    return readAgentChanges(doc).map((entry) => entry.id);
  }

  it("B1: an insertion is marked and the caret stays on its character", () => {
    const initial = "alpha omega\n";
    const { view: editor, write } = session(initial, initial.indexOf("mega"));

    write("alpha beta omega\n");

    expect(editor.state.doc.toString()).toBe("alpha beta omega\n");
    expect(highlighted(editor).join("")).toBe("beta ");
    expect(editor.state.selection.main.head).toBe("alpha beta o".length);
    expect(ghosts(editor)).toHaveLength(0);
  });

  // happy-dom lays nothing out, so the tests give each position a line box of their own:
  // position p draws at `documentTop + p × LINE` from the window's top, where `documentTop`
  // starts at the layout's value and moves up by however far the page has been scrolled.
  const LINE = 10;

  interface FakeLayout {
    /** Whether lines are drawn; when not, the follower reads the height map instead. */
    rendered?: boolean;
    documentTop?: number;
    /** Gives the editor's scroller this much room to scroll; by default it has none. */
    scrollerRange?: number;
    /** The share of each scroll that takes effect; by default the fake page never moves. */
    moves?: number;
  }

  /**
   * The follower's scrolls and settle checks, recorded instead of run, over a fake layout.
   * `scrolls` reads each scroll as the position it brought to the top of the window, which
   * is what a scroll to an empty band (`HIDDEN`) does on a page that does not move.
   */
  function scrollRecorder(layout: FakeLayout = {}) {
    const { rendered = true, documentTop = 0, scrollerRange } = layout;
    let moves = layout.moves ?? 0;
    const calls: { target: Element | Window; top: number; behavior: string }[] = [];
    const waits: { done: () => void; ms: number; cancelled: boolean }[] = [];
    // How far the page and the scroller have moved; the window starts well down a long page.
    let windowMoved = 0;
    let scrollerMoved = 0;
    const WINDOW_START = 100_000;
    const top = () => documentTop - windowMoved - scrollerMoved;
    const fake = (target: object, key: string, get: () => number) => {
      const own = Object.getOwnPropertyDescriptor(target, key);
      Object.defineProperty(target, key, { configurable: true, get });
      cleanups.push(() => {
        if (own) Object.defineProperty(target, key, own);
        else Reflect.deleteProperty(target, key);
      });
    };
    const extension = ViewPlugin.define((view) => {
      Reflect.set(view, "coordsAtPos", (pos: number) =>
        rendered
          ? { left: 0, right: 0, top: top() + pos * LINE, bottom: top() + pos * LINE + LINE }
          : null,
      );
      Reflect.set(view, "lineBlockAt", (pos: number) => ({ top: pos * LINE, height: LINE }));
      fake(view, "documentTop", top);
      if (scrollerRange !== undefined) {
        fake(view.scrollDOM, "clientHeight", () => 500);
        fake(view.scrollDOM, "scrollHeight", () => 500 + scrollerRange);
        fake(view.scrollDOM, "scrollTop", () => scrollerMoved);
      }
      fake(window, "scrollY", () => WINDOW_START + windowMoved);
      fake(window, "innerHeight", () => 1000);
      fake(document.documentElement, "scrollHeight", () => 2 * WINDOW_START);
      return {};
    });
    const follow = {
      scroll: (target: Element | Window, distance: number, behavior: string) => {
        calls.push({ target, top: distance, behavior });
        if (target === window) windowMoved += distance * moves;
        else scrollerMoved += distance * moves;
      },
      wait: (done: () => void, ms: number) => {
        const timer = { done, ms, cancelled: false };
        waits.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    };
    /** Runs the settle checks that are due and were not cancelled. */
    const settleScrolls = () => {
      for (const timer of waits.splice(0)) if (!timer.cancelled) timer.done();
    };
    return {
      calls,
      get scrolls() {
        return calls.map((call) => call.top / LINE);
      },
      /** Where position `pos` is drawn now, from the window's top. */
      screenTop: (pos: number) => top() + pos * LINE,
      /** Changes the share of each later scroll that takes effect. */
      setMoves(share: number) {
        moves = share;
      },
      waits,
      settleScrolls,
      follow,
      extension,
    };
  }

  // The follower scrolls in a microtask, never inside the change that moved the cursor.
  const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  // The tests choose the band, the way a layout would: `SHOWN` holds every line box, and
  // `HIDDEN` is empty and holds none.
  const SHOWN = { top: -1e9, bottom: 1e9 };
  const HIDDEN = { top: 0, bottom: 0 };

  describe("placementMargin", () => {
    const windowBand = { top: 0, bottom: 500 };

    it("centres a position in the band below a 300 px header in a 500 px window", () => {
      const margin = placementMargin({ top: 300, bottom: 500 }, windowBand, 20);
      // The position's top lands `margin` below the window's top: clear of the header, and
      // its middle at the band's middle.
      expect(margin).toBeGreaterThanOrEqual(300);
      expect(margin + 20 / 2).toBe(400);
    });

    it("centres in the container when there are no insets", () => {
      expect(placementMargin(windowBand, windowBand, 20) + 20 / 2).toBe(250);
    });

    it("keeps a position taller than the band at the band's top", () => {
      expect(placementMargin({ top: 300, bottom: 320 }, windowBand, 40)).toBe(300);
    });

    it("measures from a scrolling container's own top", () => {
      expect(placementMargin({ top: 150, bottom: 450 }, { top: 100, bottom: 500 }, 20)).toBe(190);
    });
  });

  describe("visibleIn", () => {
    const band = { top: 60, bottom: 700 };

    it("counts a position inside the band as visible", () => {
      expect(visibleIn({ top: 300, bottom: 320 }, band)).toBe(true);
    });

    it("counts a position under the top inset as hidden", () => {
      expect(visibleIn({ top: 30, bottom: 50 }, band)).toBe(false);
      expect(visibleIn({ top: 50, bottom: 70 }, band)).toBe(false);
    });

    it("counts a position below the band as hidden", () => {
      expect(visibleIn({ top: 690, bottom: 710 }, band)).toBe(false);
      expect(visibleIn({ top: 800, bottom: 820 }, band)).toBe(false);
    });

    it("counts a position with no coordinates, or an empty band, as hidden", () => {
      expect(visibleIn(null, band)).toBe(false);
      expect(visibleIn({ top: 0, bottom: 0 }, { top: 0, bottom: 0 })).toBe(false);
    });
  });

  it("B20: following scrolls to the agent's cursor before its write lands, and nothing else", async () => {
    let following = true;
    let band = HIDDEN;
    const recorder = scrollRecorder();
    const initial = "alpha\nbeta\ngamma\n";
    const {
      view: editor,
      user,
      write,
      type,
      moveAgentCursor,
    } = session(initial, 2, [
      followAgentChanges({ isOn: () => following, band: () => band, ...recorder.follow }),
      recorder.extension,
    ]);
    const gamma = "alpha\nbeta\n".length;

    moveAgentCursor(gamma);
    expect(recorder.scrolls).toEqual([]);
    await settle();

    expect(recorder.scrolls).toEqual([gamma]);
    // One smooth scroll of the window, which scrolls the editor here.
    expect(recorder.calls[0]?.target).toBe(window);
    expect(recorder.calls[0]?.behavior).toBe("smooth");
    expect(editor.state.selection.main.anchor).toBe(2);
    expect(editor.state.selection.main.head).toBe(2);
    expect(editor.hasFocus).toBe(false);

    // The write then lands where the view went; it does not scroll again.
    write((file) => file.replace("gamma", "GAMMA"));
    await settle();
    expect(user.text.toString()).toBe("alpha\nbeta\nGAMMA\n");
    expect(editor.state.doc.sliceString(gamma, gamma + 5)).toBe("GAMMA");
    expect(recorder.scrolls).toHaveLength(1);

    // Typing, a revert, and a log-only change never scroll.
    type(0, "x");
    const [entry] = readAgentChanges(user.doc);
    expect(revertAgentChange(editor, entry?.id ?? "")).toBe(true);
    expect(user.text.toString()).toBe(`x${initial}`);
    write((file) => file.replace("beta", "BETA"));
    clearAgentChanges(user.doc);
    await settle();
    expect(recorder.scrolls).toHaveLength(1);

    // A move to a visible position scrolls nothing.
    band = SHOWN;
    moveAgentCursor(1);
    await settle();
    expect(recorder.scrolls).toHaveLength(1);

    following = false;
    band = HIDDEN;
    moveAgentCursor(0);
    await settle();
    expect(recorder.scrolls).toHaveLength(1);
  });

  it.each([
    ["lands in view", SHOWN, 1],
    ["lands out of view", HIDDEN, 2],
  ])(
    "B20: a move, write, and park scroll once for the move, and again if the park %s",
    async (_how, parkBand, expected) => {
      let band = HIDDEN;
      const recorder = scrollRecorder();
      const initial = "one\ntwo\nthree\n";
      const { user, agent, write, moveAgentCursor } = session(initial, 0, [
        followAgentChanges({ isOn: () => true, band: () => band, ...recorder.follow }),
        recorder.extension,
      ]);
      const target = "one\ntwo\n".length;

      // The agent's cursor moves to the write's first edit, the write lands, and the cursor
      // parks at the write's end.
      moveAgentCursor(target);
      await settle();
      write((file) => file.replace("three", "three and more"));
      band = parkBand;
      moveAgentCursor(agent.text.toString().indexOf(" and more") + " and more".length);
      await settle();

      expect(user.text.toString()).toBe("one\ntwo\nthree and more\n");
      expect(recorder.scrolls).toHaveLength(expected);
      expect(recorder.scrolls[0]).toBe(target);
    },
  );

  it("follows only agent cursor moves, starting from the cursors parked at mount", async () => {
    const recorder = scrollRecorder();
    const initial = "alpha\nbeta\ngamma\n";
    const other = new Awareness(new Y.Doc());
    cleanups.push(() => other.destroy());
    const {
      view: editor,
      userAwareness,
      moveAgentCursor,
    } = session(
      initial,
      0,
      [
        followAgentChanges({ isOn: () => true, band: () => HIDDEN, ...recorder.follow }),
        recorder.extension,
      ],
      "alpha\nbeta\n".length,
    );

    // A person joining and renaming, and the user's own selection (which yCollab publishes
    // from inside a view update), are not agent moves; the parked cursor is not either.
    const relayOther = () =>
      applyAwarenessUpdate(userAwareness, encodeAwarenessUpdate(other, [other.clientID]), REMOTE);
    other.setLocalStateField("user", { name: "Reviewer", color: "#0ea5e9" });
    relayOther();
    other.setLocalStateField("user", { name: "Reviewer two", color: "#0ea5e9" });
    relayOther();
    expect(() => editor.dispatch({ selection: { anchor: 3 } })).not.toThrow();
    editor.focus();
    expect(() => editor.dispatch({ selection: { anchor: 4 } })).not.toThrow();
    await settle();
    expect(recorder.scrolls).toEqual([]);

    // (Position 0 would already sit at the top the empty band scrolls to: nothing to move.)
    moveAgentCursor(6);
    await settle();
    expect(recorder.scrolls).toEqual([6]);
  });

  it("resolves a queued move against the text as it stands when it scrolls", async () => {
    const recorder = scrollRecorder();
    const initial = "alpha\nbeta\ngamma\n";
    const {
      view: editor,
      user,
      moveAgentCursor,
    } = session(initial, 2, [
      followAgentChanges({ isOn: () => true, band: () => HIDDEN, ...recorder.follow }),
      recorder.extension,
    ]);
    const gamma = "alpha\nbeta\n".length;

    moveAgentCursor(gamma);
    // Text lands before the move's position in the same tick, ahead of the scroll.
    const landed = "x".repeat(1000);
    user.text.insert(0, landed);
    expect(recorder.scrolls).toEqual([]);
    await settle();

    expect(recorder.scrolls).toEqual([landed.length + gamma]);
    expect(editor.state.doc.sliceString(landed.length + gamma, landed.length + gamma + 5)).toBe(
      "gamma",
    );
    // The caret moved with the inserted text only: it is still on the same character.
    expect(editor.state.selection.main.empty).toBe(true);
    expect(editor.state.selection.main.head).toBe(landed.length + 2);
    expect(editor.hasFocus).toBe(false);
  });

  it("never scrolls inside the editor update an agent move arrives in", async () => {
    const recorder = scrollRecorder();
    let moveDuringUpdate: (() => void) | null = null;
    // A contrived host that moves the agent's cursor while the view is still updating.
    const midUpdate = EditorView.updateListener.of((update) => {
      if (update.docChanged && moveDuringUpdate) {
        const move = moveDuringUpdate;
        moveDuringUpdate = null;
        move();
      }
    });
    const { view: editor, moveAgentCursor } = session("alpha\nbeta\n", 0, [
      followAgentChanges({ isOn: () => true, band: () => HIDDEN, ...recorder.follow }),
      recorder.extension,
      midUpdate,
    ]);
    moveDuringUpdate = () => moveAgentCursor(6);

    expect(() => editor.dispatch({ changes: { from: 0, insert: "x" } })).not.toThrow();
    expect(recorder.scrolls).toEqual([]);
    await settle();

    // Index 6 of the agent's text, which already held the "x": the line break after "alpha".
    expect(recorder.scrolls).toEqual([6]);
    expect(editor.state.doc.sliceString(6, 7)).toBe("\n");
  });

  describe("B23: smooth following", () => {
    // A band below a 300 px header: its centre is at 400, so a LINE-tall line goes to 395.
    const BAND = { top: 300, bottom: 500 };
    const centredTop = (BAND.top + BAND.bottom) / 2 - LINE / 2;

    function follower(
      band: () => typeof BAND = () => BAND,
      layout: FakeLayout = {},
      initial = "alpha\nbeta\ngamma\ndelta\n",
    ) {
      const recorder = scrollRecorder(layout);
      const made = session(initial, 2, [
        followAgentChanges({ isOn: () => true, band, ...recorder.follow }),
        recorder.extension,
      ]);
      return { ...made, recorder };
    }

    it("asks the scrolling container for one smooth scroll that centres the line in the band", async () => {
      const { view: editor, moveAgentCursor, recorder } = follower();
      const gamma = "alpha\nbeta\n".length;

      moveAgentCursor(gamma);
      await settle();

      expect(recorder.calls).toEqual([
        { target: window, top: gamma * LINE - centredTop, behavior: "smooth" },
      ]);
      expect(recorder.waits.map((timer) => timer.ms)).toEqual([450]);
      expect(editor.state.selection.main.head).toBe(2);
      expect(editor.hasFocus).toBe(false);
    });

    it("jumps instead under reduced motion", async () => {
      const matchMedia = window.matchMedia;
      const ignore = () => {};
      Reflect.set(window, "matchMedia", (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        addListener: ignore,
        removeListener: ignore,
        addEventListener: ignore,
        removeEventListener: ignore,
      }));
      cleanups.push(() => Reflect.set(window, "matchMedia", matchMedia));
      const { moveAgentCursor, recorder } = follower();

      moveAgentCursor(6);
      await settle();

      expect(recorder.calls).toEqual([
        { target: window, top: 6 * LINE - centredTop, behavior: "instant" },
      ]);
    });

    it("corrects once after the scroll settles if the line is still outside the band", async () => {
      const { moveAgentCursor, recorder } = follower();
      moveAgentCursor(6);
      await settle();
      expect(recorder.calls).toHaveLength(1);

      // The line's real height put it elsewhere: still outside, so one more scroll.
      recorder.settleScrolls();
      expect(recorder.calls).toHaveLength(2);
      expect(recorder.calls[1]).toEqual({
        target: window,
        top: 6 * LINE - centredTop,
        behavior: "smooth",
      });

      // There is no third.
      recorder.settleScrolls();
      expect(recorder.calls).toHaveLength(2);
    });

    it("does not correct a scroll that landed the line in the band", async () => {
      let band = BAND;
      const { moveAgentCursor, recorder } = follower(() => band);
      moveAgentCursor(6);
      await settle();

      band = SHOWN;
      recorder.settleScrolls();

      expect(recorder.calls).toHaveLength(1);
    });

    // A long note, so the cursor can sit far below the window.
    const LONG = "line\n".repeat(60);
    const inBand = (top: number) => top >= BAND.top && top + LINE <= BAND.bottom;

    it("passes what an inner scroller cannot take on to the window", async () => {
      const {
        view: editor,
        moveAgentCursor,
        recorder,
      } = follower(
        () => BAND,
        {
          scrollerRange: 1,
          moves: 1,
        },
        LONG,
      );
      const pos = 150;
      expect(recorder.screenTop(pos)).toBe(1500);

      moveAgentCursor(pos);
      await settle();

      // The scroller's one pixel, then the rest from the window.
      const distance = pos * LINE - centredTop;
      expect(recorder.calls).toEqual([
        { target: editor.scrollDOM, top: 1, behavior: "smooth" },
        { target: window, top: distance - 1, behavior: "smooth" },
      ]);
      expect(inBand(recorder.screenTop(pos))).toBe(true);
      recorder.settleScrolls();
      expect(recorder.calls).toHaveLength(2);
    });

    it("lets a scroller with room take the whole distance", async () => {
      const {
        view: editor,
        moveAgentCursor,
        recorder,
      } = follower(
        () => BAND,
        {
          scrollerRange: 100_000,
          moves: 1,
        },
        LONG,
      );

      moveAgentCursor(150);
      await settle();

      expect(recorder.calls).toEqual([
        { target: editor.scrollDOM, top: 150 * LINE - centredTop, behavior: "smooth" },
      ]);
      expect(inBand(recorder.screenTop(150))).toBe(true);
    });

    it("places an undrawn line from the height map and the document's top", async () => {
      const { moveAgentCursor, recorder } = follower(
        () => BAND,
        {
          rendered: false,
          documentTop: 40,
          moves: 1,
        },
        LONG,
      );

      moveAgentCursor(150);
      await settle();

      expect(recorder.calls).toEqual([
        { target: window, top: 40 + 150 * LINE - centredTop, behavior: "smooth" },
      ]);
      // Still undrawn after settling, but the height map now puts it in the band: the
      // correction has nothing left to move.
      recorder.settleScrolls();
      expect(recorder.calls).toHaveLength(1);
      expect(inBand(recorder.screenTop(150))).toBe(true);
    });

    it("corrects from wherever a partly finished scroll left the line", async () => {
      const { moveAgentCursor, recorder } = follower(() => BAND, { moves: 0.5 }, LONG);
      moveAgentCursor(150);
      await settle();
      const distance = 150 * LINE - centredTop;
      expect(recorder.calls.map((call) => call.top)).toEqual([distance]);
      // Only half of it happened (the estimate was off, or the scroll was cut short).
      expect(inBand(recorder.screenTop(150))).toBe(false);

      recorder.setMoves(1);
      recorder.settleScrolls();

      expect(recorder.calls.map((call) => call.top)).toEqual([distance, distance / 2]);
      expect(inBand(recorder.screenTop(150))).toBe(true);
    });

    it("drops the earlier settle check when a newer move comes first", async () => {
      const { moveAgentCursor, recorder } = follower();
      moveAgentCursor(6);
      await settle();
      moveAgentCursor(11);
      await settle();
      expect(recorder.calls.map((call) => call.top)).toEqual([
        6 * LINE - centredTop,
        11 * LINE - centredTop,
      ]);

      recorder.settleScrolls();

      // Only the newer move's check ran.
      expect(recorder.calls.map((call) => call.top)).toEqual([
        6 * LINE - centredTop,
        11 * LINE - centredTop,
        11 * LINE - centredTop,
      ]);
    });
  });

  it("keeps a ghost drawn when the agent's cursor leaves its anchor", () => {
    const initial = "## What\n\n- a line\n- b line\n- c line\n\n## Notes\n";
    const { view: editor, write, moveAgentCursor, agent } = session(initial, 0);
    // The agent's cursor sits where it is about to write, then parks at the write's end:
    // the ghost and the agent's caret share a position, then part.
    moveAgentCursor(initial.indexOf("- a"));
    write(initial.replace("- a line\n- b line\n- c line", "Para text here."));
    expect(ghosts(editor)).toHaveLength(1);

    moveAgentCursor(agent.text.toString().indexOf("here.") + "here.".length);

    expect(onlyGhost(editor).textContent).toBe("- a line+2 lines");
    expect(editor.contentDOM.querySelectorAll(".cm-ySelectionCaret")).toHaveLength(1);
  });

  it("B2: a deletion shows a struck-through, tinted ghost of the deleted words", () => {
    const { view: editor, user, write } = session("keep old words here\n");

    write("keep here\n");

    const ghost = onlyGhost(editor);
    expect(ghost.textContent).toBe("old words ");
    expect(ghost.querySelector("del")?.textContent).toBe("old words ");
    expect(ghost.style.getPropertyValue("--atlas-agent-color")).toBe(TURN.color);
    expect(editor.posAtDOM(ghost)).toBe("keep ".length);
    expect(user.text.toString()).toBe("keep here\n");
    expect(user.text.toString()).not.toContain("old words");
  });

  it("B3: Restore puts the words back unmarked, drops the ghost, and undoes on its own", () => {
    const { view: editor, user, write, undoManager } = session("keep old words here\n");
    write("keep here\n");

    onlyGhost(editor).click();
    popoverAction("Restore").click();

    expect(user.text.toString()).toBe("keep old words here\n");
    expect(editor.state.doc.toString()).toBe("keep old words here\n");
    expect(highlighted(editor)).toEqual([]);
    expect(ghosts(editor)).toHaveLength(0);
    expect(document.querySelector(".atlas-agent-ghost-popover")).toBeNull();
    expect(readAgentChanges(user.doc)).toEqual([]);

    undoManager.undo();

    expect(user.text.toString()).toBe("keep here\n");
  });

  it("B4: Dismiss hides the ghost, leaves the text, and keeps the deletion for revert", () => {
    const { view: editor, user, write } = session("keep old words here\n");
    write("keep here\n");

    onlyGhost(editor).click();
    popoverAction("Dismiss").click();

    expect(user.text.toString()).toBe("keep here\n");
    expect(ghosts(editor)).toHaveLength(0);
    const [entry] = readAgentChanges(user.doc);
    expect(entry?.ops.map(({ deleted, dismissed }) => ({ deleted, dismissed }))).toEqual([
      { deleted: "old words ", dismissed: true },
    ]);
    // Nothing is left to step to.
    expect(nextAgentChange(editor)).toBe(false);

    expect(revertAgentChange(editor, entry?.id ?? "")).toBe(true);

    expect(user.text.toString()).toBe("keep old words here\n");
    expect(readAgentChanges(user.doc)).toEqual([]);
    expect(barCount(editor)).toBeNull();
  });

  it("B5: a ghost stays after its character; typing at its anchor lands before it", () => {
    const { view: editor, user, write, type } = session("alpha old words omega\n");
    write("alpha omega\n");
    const anchor = editor.posAtDOM(onlyGhost(editor));
    expect(anchor).toBe("alpha ".length);

    type(0, "0123456789");

    expect(editor.posAtDOM(onlyGhost(editor))).toBe(anchor + 10);
    expect(editor.state.doc.sliceString(0, anchor + 10)).toBe("0123456789alpha ");

    type(anchor + 10, "XY");

    const moved = editor.posAtDOM(onlyGhost(editor));
    expect(moved).toBe(anchor + 12);
    expect(editor.state.doc.sliceString(anchor + 10, moved)).toBe("XY");
    // The stored relative position agrees with the view.
    expect(readAgentChanges(user.doc)[0]?.ops[0]?.from).toBe(moved);
  });

  it("B6: a replaced sentence's ghost holds the user's unsent words", () => {
    const initial = "Intro.\nThe quick brown fox jumps over the dog.\nOutro.\n";
    const { view: editor, user, write, type } = session(initial);
    type(initial.indexOf("brown"), "mine ");

    write("Intro.\nAgents rewrite whole sentences now.\nOutro.\n");

    expect(user.text.toString()).toBe("Intro.\nAgents rewrite whole sentences now.\nOutro.\n");
    expect(onlyGhost(editor).textContent).toBe("The quick mine brown fox jumps over the dog");
    expect(highlighted(editor).join("")).toBe("Agents rewrite whole sentences now");
  });

  it("B7: a three-line deletion collapses and expands on click; a short one does not", () => {
    const { view: editor, write } = session("# Title\nline one\nline two\nline three\nend\n");
    write("# Title\nend\n");

    const collapsed = onlyGhost(editor);
    expect(collapsed.classList.contains("atlas-agent-ghost-collapsed")).toBe(true);
    expect(collapsed.querySelector("del")?.textContent).toBe("line one");
    expect(collapsed.querySelector(".atlas-agent-ghost-more")?.textContent).toBe("+2 lines");

    collapsed.click();

    // One click expands the ghost and opens its popover.
    expect(document.querySelector(".atlas-agent-ghost-popover")).not.toBeNull();
    const expanded = onlyGhost(editor);
    expect(expanded.classList.contains("atlas-agent-ghost-collapsed")).toBe(false);
    expect(expanded.textContent).toBe("line one\nline two\nline three\n");

    write("# Title\n");
    const short = ghosts(editor).find((ghost) => ghost.textContent === "end\n");
    expect(short?.classList.contains("atlas-agent-ghost-collapsed")).toBe(false);
  });

  it("B5: at the end of the text a ghost sticks to the character before it, through a refresh", () => {
    const { view: editor, user, agent, write, type } = session("keep old");
    write("keep");
    const line = () => editor.contentDOM.querySelector(".cm-line")?.textContent;
    const anchors = () => ({
      drawn: editor.posAtDOM(onlyGhost(editor)),
      resolved: readAgentChanges(user.doc)[0]?.ops[0]?.from,
    });
    expect(anchors()).toEqual({ drawn: 4, resolved: 4 });

    type(4, "XY");

    // Typed text lands after the ghost, which stays glued to the "p" of "keep".
    expect(user.text.toString()).toBe("keepXY");
    expect(line()).toBe("keep oldXY");
    expect(anchors()).toEqual({ drawn: 4, resolved: 4 });

    // A remote edit elsewhere makes the view resolve the log again; nothing moves.
    agent.text.insert(0, "> ");

    expect(user.text.toString()).toBe("> keepXY");
    expect(line()).toBe("> keep oldXY");
    expect(anchors()).toEqual({ drawn: 6, resolved: 6 });
  });

  it("B8: one entry per write, counted by the bar; accept drops one and keeps the text", () => {
    const { view: editor, user, write } = session("one\ntwo\nthree\n");
    write("one\ntwo\nthree\nfour\n");
    write((file) => file.replace("two\n", ""));
    write((file) => file.replace("one", "ONE"));

    const ids = entryIds(user.doc);
    expect(ids).toHaveLength(3);
    expect(barCount(editor)).toBe("3 agent changes");
    const text = user.text.toString();
    expect(text).toBe("ONE\nthree\nfour\n");
    // A mark's text holds no line break: the line itself ends there.
    expect(highlighted(editor)).toEqual(["ONE", "four"]);

    expect(acceptAgentChange(editor, ids[2] ?? "")).toBe(true);

    expect(entryIds(user.doc)).toEqual(ids.slice(0, 2));
    expect(barCount(editor)).toBe("2 agent changes");
    expect(highlighted(editor)).toEqual(["four"]);
    expect(ghosts(editor).map((ghost) => ghost.textContent)).toEqual(["two\n"]);
    expect(user.text.toString()).toBe(text);

    expect(acceptAgentChange(editor, ids[1] ?? "")).toBe(true);
    expect(ghosts(editor)).toHaveLength(0);
    expect(user.text.toString()).toBe(text);
  });

  it("B8: accepting a write nested inside an earlier one removes only the later write's marks", () => {
    const { view: editor, user, write } = session("start\nend\n");
    write("start\nalpha\nbeta\nend\n");
    write("start\nalpha\nNEW\nbeta\nend\n");
    const [outer, nested] = entryIds(user.doc);
    const text = user.text.toString();
    expect(text).toBe("start\nalpha\nNEW\nbeta\nend\n");
    expect(highlighted(editor)).toEqual(["alpha", "NEW", "beta"]);

    expect(acceptAgentChange(editor, nested ?? "")).toBe(true);

    expect(highlighted(editor)).toEqual(["alpha", "beta"]);
    expect(user.text.toString()).toBe(text);

    // The outer write's revert leaves the nested write's characters alone.
    expect(revertAgentChange(editor, outer ?? "")).toBe(true);
    expect(user.text.toString()).toBe("start\nNEW\nend\n");
    expect(highlighted(editor)).toEqual([]);
  });

  it("B9: revert keeps the user's characters, restores deletions, each one undo step", () => {
    const {
      view: editor,
      user,
      write,
      type,
      undoManager,
    } = session("start\nkeep gone here\nend\n");
    write("start\nalpha beta\nkeep gone here\nend\n");
    const [inserted] = entryIds(user.doc);
    type(editor.state.doc.toString().indexOf(" beta"), "X");
    write((file) => file.replace("gone ", ""));
    const [, deleted] = entryIds(user.doc);
    const before = user.text.toString();
    expect(before).toBe("start\nalphaX beta\nkeep here\nend\n");

    expect(revertAgentChange(editor, inserted ?? "")).toBe(true);
    expect(user.text.toString()).toBe("start\nXkeep here\nend\n");

    expect(revertAgentChange(editor, deleted ?? "")).toBe(true);
    expect(user.text.toString()).toBe("start\nXkeep gone here\nend\n");
    expect(highlighted(editor)).toEqual([]);
    expect(readAgentChanges(user.doc)).toEqual([]);

    undoManager.undo();
    expect(user.text.toString()).toBe("start\nXkeep here\nend\n");
    undoManager.undo();
    expect(user.text.toString()).toBe(before);
  });

  it("B10: next and previous step through ops in document order and wrap", () => {
    const { view: editor, write } = session("aaa\nbbb\nccc\nddd\n", 0);
    expect(nextAgentChange(editor)).toBe(false);
    expect(previousAgentChange(editor)).toBe(false);

    write((file) => file.replace("ccc", "CCC"));
    write((file) => file.replace("aaa", "AAA"));
    write((file) => file.replace("ddd\n", ""));
    expect(editor.state.doc.toString()).toBe("AAA\nbbb\nCCC\n");
    const head = () => editor.state.selection.main.head;
    const steps = (command: (view: EditorView) => boolean, count: number) =>
      Array.from({ length: count }, () => (command(editor) ? head() : -1));

    // The ops start at 0 (AAA), 8 (CCC), and 12 (the ghost of "ddd" at the end).
    expect(steps(nextAgentChange, 4)).toEqual([8, 12, 0, 8]);
    expect(steps(previousAgentChange, 4)).toEqual([0, 12, 8, 0]);
  });

  it("B11: when the presence drops the turn, its marks and ghosts settle and stay reviewable", () => {
    const { view: editor, user, write, endTurn } = session("keep old words here\n");
    write("keep here and more\n");
    const settled = () => [...editor.dom.querySelectorAll(".atlas-agent-change-settled")];
    expect(settled()).toHaveLength(0);

    endTurn();

    expect(settled().length).toBeGreaterThan(0);
    expect(onlyGhost(editor).classList.contains("atlas-agent-change-settled")).toBe(true);
    const marks = [...editor.dom.querySelectorAll(".atlas-agent-change")];
    expect(marks.every((mark) => mark.classList.contains("atlas-agent-change-settled"))).toBe(true);
    expect(readAgentChanges(user.doc)).toHaveLength(1);

    expect(revertAgentChange(editor, entryIds(user.doc)[0] ?? "")).toBe(true);
    expect(user.text.toString()).toBe("keep old words here\n");
  });

  it("B12: accept all empties the turn; revert all returns the pre-turn text plus the user's", () => {
    const initial =
      "# Note\n\nFirst sentence here. Second one.\n\n- item a\n- item b\n\n## Notes\n";
    const accepting = session(initial);
    accepting.write((file) => `${file}- added\n`);
    accepting.write((file) => file.replace("- item b\n", ""));
    const accepted = accepting.user.text.toString();
    expect(acceptTurn(accepting.view, "turn-1")).toBe(true);
    expect(readAgentChanges(accepting.user.doc)).toEqual([]);
    expect(accepting.user.text.toString()).toBe(accepted);
    expect(accepting.view.dom.querySelector(".atlas-agent-change, .atlas-agent-ghost")).toBeNull();
    accepting.view.destroy();

    const { view: editor, user, write, type, endTurn } = session(initial);
    type(initial.indexOf("Second"), "Typed. ");
    write((file) => `${file}- the agent's note\n`);
    write((file) => file.replace("First sentence here.", "A rewritten sentence."));
    write((file) => file.replace("- item b\n", ""));
    endTurn();
    expect(barCount(editor)).toBe("3 agent changes");

    barButton(editor, "Revert all").click();

    expect(user.text.toString()).toBe(
      "# Note\n\nFirst sentence here. Typed. Second one.\n\n- item a\n- item b\n\n## Notes\n",
    );
    expect(readAgentChanges(user.doc)).toEqual([]);
    expect(barCount(editor)).toBeNull();
    expect(revertTurn(editor, "turn-1")).toBe(false);
  });

  it("B12: revert all is exact when the turn's writes overlap", () => {
    const first = session("\n");
    first.write("alpha\n");
    first.write("beta\n");
    expect(first.user.text.toString()).toBe("beta\n");
    expect(revertTurn(first.view, "turn-1")).toBe(true);
    expect(first.user.text.toString()).toBe("\n");
    first.view.destroy();

    const { view: editor, user, write, type } = session("pre\n\npost\n");
    write("pre\nalpha\npost\n");
    type("pre\nal".length, "X");
    write("pre\nbeta\npost\n");
    expect(user.text.toString()).toBe("pre\nbeta\npost\n");
    expect(
      ghosts(editor)
        .map((ghost) => ghost.textContent)
        .join(""),
    ).toContain("alXph");

    expect(revertTurn(editor, "turn-1")).toBe(true);

    expect(user.text.toString()).toBe("pre\nX\npost\n");
    expect(readAgentChanges(user.doc)).toEqual([]);
    expect(highlighted(editor)).toEqual([]);
  });

  it("B12: revert all re-anchors an earlier write's ops inside text a later revert restored", () => {
    const plain = session("a-----b\n");
    plain.write("X-----Y\n");
    expect(readAgentChanges(plain.user.doc)[0]?.ops).toHaveLength(2);
    plain.write("Z\n");
    expect(plain.user.text.toString()).toBe("Z\n");
    expect(revertTurn(plain.view, "turn-1")).toBe(true);
    expect(plain.user.text.toString()).toBe("a-----b\n");
    plain.view.destroy();

    // The user's "u" in the separator came back with the later write's revert and stays.
    const { view: editor, user, write, type } = session("a-----b\n");
    write("X-----Y\n");
    type(3, "u");
    write("Z\n");
    expect(user.text.toString()).toBe("Z\n");
    expect(revertTurn(editor, "turn-1")).toBe(true);
    expect(user.text.toString()).toBe("a--u---b\n");
    expect(readAgentChanges(user.doc)).toEqual([]);
  });

  it("B18: a malformed remote entry is ignored, and later writes and commands still work", () => {
    const { view: editor, user, agent, write } = session("keep old words here\n");
    const log = agent.doc.getArray<unknown>("agentChanges");
    const malformed = {
      id: "9:0",
      turnId: "turn-1",
      client: 9,
      name: "Agent",
      color: "#7c3aed",
      at: 0,
      clock: { from: 0, to: 0 },
      // Decodes to a relative position with no item, type, or type name.
      ops: [{ from: [3], to: [3], assoc: 1, deleted: "x", items: [], dismissed: false }],
    };

    expect(() => log.push([malformed, "not an entry", { ops: 3 }])).not.toThrow();
    expect(readAgentChanges(user.doc)).toEqual([]);
    expect(barCount(editor)).toBeNull();

    write("keep here\n");
    const [entry] = readAgentChanges(user.doc);
    expect(entry?.ops[0]?.deleted).toBe("old words ");
    expect(onlyGhost(editor).textContent).toBe("old words ");
    expect(revertAgentChange(editor, entry?.id ?? "")).toBe(true);
    expect(user.text.toString()).toBe("keep old words here\n");
  });

  it("B19: another client's review never retargets an open popover", () => {
    const { view: editor, user, write } = session("one AA two BB three CC four\n");
    write("one two three four\n");
    const [entry] = readAgentChanges(user.doc);
    expect(entry?.ops.map((op) => op.deleted)).toEqual(["AA ", "BB ", "CC "]);

    // A second client on the same note, with its own editor.
    const other = peer(3);
    connect(user.doc, other.doc);
    const otherAwareness = new Awareness(other.doc);
    const otherView = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: other.text.toString(),
        extensions: [yCollab(other.text, otherAwareness), agentChanges(other.text, otherAwareness)],
      }),
    });
    cleanups.push(() => {
      otherView.destroy();
      otherAwareness.destroy();
    });

    ghosts(editor)
      .find((ghost) => ghost.textContent === "BB ")
      ?.click();
    expect(document.querySelector(".atlas-agent-ghost-popover")).not.toBeNull();

    expect(restoreAgentDeletion(otherView, entry?.id ?? "", 0)).toBe(true);
    expect(user.text.toString()).toBe("one AA two three four\n");

    popoverAction("Restore").click();

    expect(user.text.toString()).toBe("one AA two BB three four\n");
    expect(ghosts(editor).map((ghost) => ghost.textContent)).toEqual(["CC "]);
    expect(readAgentChanges(user.doc)[0]?.ops.map((op) => op.deleted)).toEqual(["", "", "CC "]);
  });

  /**
   * A clock, frames, and timers the test steps by hand. The clock is the wall clock plus an
   * offset the test moves on, since entries carry the wall-clock time they were written.
   */
  function manualTime() {
    let offset = 0;
    const now = () => Date.now() + offset;
    let frames: (() => void)[] = [];
    let timers: { at: number; done: () => void }[] = [];
    return {
      now,
      schedule(frame: () => void) {
        frames.push(frame);
        return () => {
          frames = frames.filter((queued) => queued !== frame);
        };
      },
      wait(done: () => void, ms: number) {
        const timer = { at: now() + ms, done };
        timers.push(timer);
        return () => {
          timers = timers.filter((queued) => queued !== timer);
        };
      },
      /** Moves the clock on by `ms`, then runs the frame that was waiting. */
      frame(ms: number) {
        offset += ms;
        const due = frames;
        frames = [];
        for (const frame of due) frame();
      },
      /** Moves the clock on by `ms`, then runs the timers that came due. */
      elapse(ms: number) {
        offset += ms;
        const time = now();
        const due = timers.filter((timer) => timer.at <= time);
        timers = timers.filter((timer) => timer.at > time);
        for (const timer of due) timer.done();
      },
      pendingFrames: () => frames.length,
    };
  }

  /** The note's text as the editor shows it, line by line, without hidden parts. */
  function drawn(editor: EditorView) {
    return [...editor.contentDOM.querySelectorAll(".cm-line")]
      .map((line) => {
        const copy = line.cloneNode(true);
        if (!(copy instanceof Element)) return "";
        for (const hidden of copy.querySelectorAll(".atlas-agent-reveal-hidden")) hidden.remove();
        return copy.textContent ?? "";
      })
      .join("\n");
  }

  /** The ranges of `editor`'s decorations that `keep` picks. */
  function decorated(
    editor: EditorView,
    keep: (decoration: Decoration, from: number, to: number) => boolean,
  ) {
    const ranges: [number, number][] = [];
    for (const source of editor.state.facet(EditorView.decorations)) {
      const set = typeof source === "function" ? source(editor) : source;
      set.between(0, editor.state.doc.length, (from, to, decoration) => {
        if (keep(decoration, from, to)) ranges.push([from, to]);
      });
    }
    return ranges;
  }

  /** The reveal's hiding marks. */
  const hiding = (editor: EditorView) =>
    decorated(editor, (decoration) => decoration.spec.class === "atlas-agent-reveal-hidden");

  /** Every replacing decoration: the reveal must never use one. */
  const replacing = (editor: EditorView) =>
    decorated(editor, (decoration, from, to) => decoration.point && to > from);

  /** The editor's layout as far as happy-dom has one: its lines and the text they hold. */
  const layout = (editor: EditorView) => ({
    lines: editor.contentDOM.querySelectorAll(".cm-line").length,
    characters: editor.contentDOM.textContent?.length ?? 0,
  });

  it("B21: a write lands at once and its inserted text is revealed over frames", () => {
    const time = manualTime();
    const inserted = "word ".repeat(24);
    expect(inserted).toHaveLength(120);
    const {
      view: editor,
      user,
      write,
      type,
    } = session("start\nend\n", 2, [revealAgentChanges(time)]);

    write(`start\n${inserted}\nend\n`);

    // The document holds the whole write at once; only its drawing is behind.
    const full = `start\n${inserted}\nend\n`;
    expect(user.text.toString()).toBe(full);
    expect(editor.state.doc.toString()).toBe(full);
    expect(editor.state.selection.main.head).toBe(2);
    // The drawn lines join with line breaks, so a fully drawn note reads as the text.
    const hidden = () => editor.state.doc.length - drawn(editor).length;
    expect(hidden()).toBeGreaterThanOrEqual(120);
    // The tail is hidden in place by a mark, never collapsed by a replacement, so it is laid
    // out (and wraps the insertion's tint) from the start.
    expect(hiding(editor)).toEqual([[6, 6 + inserted.length + 1]]);
    expect(replacing(editor)).toEqual([]);
    expect(
      editor.contentDOM.querySelector(".atlas-agent-reveal-hidden .atlas-agent-change"),
    ).not.toBeNull();
    const landed = layout(editor);
    expect(landed.characters).toBe(full.length - 3);

    const seen = [hidden()];
    for (let elapsed = 0; elapsed < 800; elapsed += 50) {
      time.frame(50);
      seen.push(hidden());
      // Nothing moves while the reveal advances: same lines, same laid-out text.
      expect(layout(editor)).toEqual(landed);
      expect(replacing(editor)).toEqual([]);
    }
    expect(seen.every((left, i) => i === 0 || left <= (seen[i - 1] ?? left))).toBe(true);
    expect(seen.at(-1)).toBe(0);
    expect(drawn(editor)).toBe(full);
    expect(time.pendingFrames()).toBe(0);
    expect(editor.state.selection.main.head).toBe(2);

    // A user edit inside the hidden part finishes the reveal in the same transaction.
    write((file) => file.replace("end", `more ${inserted}end`));
    expect(hidden()).toBeGreaterThan(0);
    const inside = editor.state.doc.toString().lastIndexOf("word");
    type(inside, "X");
    expect(hidden()).toBe(0);
    expect(drawn(editor)).toContain("X");
    // With nothing left to reveal, the frame loop has stopped.
    expect(time.pendingFrames()).toBe(0);

    // So does the selection moving into it.
    write((file) => `${file}tail ${inserted}`);
    expect(hidden()).toBeGreaterThan(0);
    editor.dispatch({ selection: { anchor: editor.state.doc.length - 3 } });
    expect(hidden()).toBe(0);

    // The hidden text is laid out and can take the caret, so an arrow key reaching it
    // finishes the reveal too.
    const before = editor.state.doc.length;
    write((file) => `${file}\nagain ${inserted}`);
    const [[tailFrom] = [0]] = hiding(editor);
    expect(tailFrom).toBe(before);
    editor.dispatch({ selection: { anchor: tailFrom - 1 } });
    expect(hidden()).toBeGreaterThan(0);
    expect(cursorCharRight(editor)).toBe(true);
    expect(editor.state.selection.main.head).toBe(tailFrom);
    expect(hidden()).toBe(0);
  });

  it("B21: with the reveal off, or reduced motion, nothing is ever hidden", () => {
    const inserted = "word ".repeat(24);
    const time = manualTime();
    const off = session("start\n", 0, [revealAgentChanges({ ...time, isOn: () => false })]);
    off.write(`start\n${inserted}\n`);
    expect(drawn(off.view)).toBe(`start\n${inserted}\n`);
    expect(time.pendingFrames()).toBe(0);
    off.view.destroy();

    const matchMedia = window.matchMedia;
    const ignore = () => {};
    Reflect.set(window, "matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addListener: ignore,
      removeListener: ignore,
      addEventListener: ignore,
      removeEventListener: ignore,
    }));
    cleanups.push(() => Reflect.set(window, "matchMedia", matchMedia));
    const reduced = session("keep old words\n", 0, [revealAgentChanges(time)]);
    reduced.write(`keep old words\n${inserted}\n`);
    expect(drawn(reduced.view)).toBe(`keep old words\n${inserted}\n`);
    // Nor does a ghost fade in.
    reduced.write((file) => file.replace("old ", ""));
    expect(onlyGhost(reduced.view).classList.contains("atlas-agent-ghost-arriving")).toBe(false);
    expect(time.pendingFrames()).toBe(0);
  });

  it("B21: edits before the hidden part keep what was drawn, and never invert the range", () => {
    const time = manualTime();
    const prefix = "0123456789";
    const inserted = "abcdefghij".repeat(12);
    const { view: editor, user, write } = session(`${prefix}\n`, 0, [revealAgentChanges(time)]);
    // The hiding mark is a valid range the whole time, and nothing is replaced.
    const replaced = () => {
      expect(replacing(editor)).toEqual([]);
      return hiding(editor);
    };

    write(`${prefix}${inserted}\n`);
    expect(replaced()).toEqual([[10, 130]]);
    // 90 of the 120 characters are drawn: the reveal is three quarters of 800 ms in.
    time.frame(600);
    expect(replaced()).toEqual([[100, 130]]);

    // Deleting [10, 90) touches neither the hidden part nor the selection.
    expect(() => editor.dispatch({ changes: { from: 10, to: 90 } })).not.toThrow();

    expect(user.text.toString()).toBe(`${prefix}${inserted.slice(80)}\n`);
    expect(replaced()).toEqual([[20, 50]]);
    expect(drawn(editor)).toBe(`${prefix}${inserted.slice(80, 90)}\n`);

    // Typing inside the drawn prefix keeps the typed characters drawn.
    editor.dispatch({ changes: { from: 15, insert: "TYPED" } });
    expect(replaced()).toEqual([[25, 55]]);
    expect(drawn(editor)).toBe(
      `${prefix}${inserted.slice(80, 85)}TYPED${inserted.slice(85, 90)}\n`,
    );

    time.frame(200);
    expect(replaced()).toEqual([]);
    expect(drawn(editor)).toBe(editor.state.doc.toString());
  });

  it("B21: the hidden part steps over padded inline constructs, revealing each whole", () => {
    const time = manualTime();
    const { view: editor, write } = session("start\n", 0, [
      livePreview(),
      revealAgentChanges(time),
    ]);
    const paragraph =
      "Some words before `inline code here` and then #atag/nested after it, with more words.";

    write(`start\n${paragraph}\n`);
    finishParse(editor);

    const atoms: { name: string; from: number; to: number }[] = [];
    syntaxTree(editor.state).iterate({
      enter: (node) => {
        if (node.name === "InlineCode" || node.name === "Tag") {
          atoms.push({ name: node.name, from: node.from, to: node.to });
        }
      },
    });
    expect(atoms.map((atom) => atom.name)).toEqual(["InlineCode", "Tag"]);

    const boundaries: number[] = [];
    let elapsed = 0;
    while (hiding(editor).length > 0 && elapsed <= 800) {
      time.frame(16);
      elapsed += 16;
      const [range] = hiding(editor);
      if (range) boundaries.push(range[0]);
    }

    // Finished within the cap.
    expect(hiding(editor)).toEqual([]);
    expect(elapsed).toBeLessThanOrEqual(800);
    for (const atom of atoms) {
      // Never strictly inside; the first rest past its start is its end.
      expect(boundaries.filter((at) => at > atom.from && at < atom.to)).toEqual([]);
      expect(boundaries.find((at) => at > atom.from)).toBe(atom.to);
    }
  });

  it("B22: ghosts of entries already logged at mount still arrive while they are young", () => {
    const mountGhosts = (age: number) => {
      const user = peer(1);
      const agent = peer(2);
      user.text.insert(0, "keep old words here\n");
      connect(user.doc, agent.doc);
      const agentAwareness = new Awareness(agent.doc);
      const userAwareness = new Awareness(user.doc);
      cleanups.push(() => {
        agentAwareness.destroy();
        userAwareness.destroy();
      });
      applyFileText(agent.text, "keep old words here\n", "keep here\n", { log: TURN });
      // The editor mounts `age` ms after the write was logged.
      const time = manualTime();
      time.elapse(age);
      const mounted = new EditorView({
        parent: document.body,
        state: EditorState.create({
          doc: user.text.toString(),
          extensions: [
            yCollab(user.text, userAwareness),
            agentChanges(user.text, userAwareness),
            revealAgentChanges(time),
          ],
        }),
      });
      cleanups.push(() => mounted.destroy());
      const isArriving = () => onlyGhost(mounted).classList.contains("atlas-agent-ghost-arriving");
      return { time, isArriving };
    };

    const young = mountGhosts(100);
    expect(young.isArriving()).toBe(true);
    young.time.elapse(150);
    expect(young.isArriving()).toBe(true);
    young.time.elapse(60);
    expect(young.isArriving()).toBe(false);
    document.body.innerHTML = "";

    const old = mountGhosts(400);
    expect(old.isArriving()).toBe(false);
    old.time.elapse(1000);
    expect(old.isArriving()).toBe(false);
  });

  it("B22: a ghost drawn while its entry is younger than 300 ms carries the arriving class", () => {
    const time = manualTime();
    const { view: editor, write } = session("keep old words here\nand gone here\n", 0, [
      revealAgentChanges(time),
    ]);

    write("keep here\nand gone here\n");

    const isArriving = (ghost: HTMLElement | undefined) =>
      ghost?.classList.contains("atlas-agent-ghost-arriving") ?? false;
    expect(isArriving(onlyGhost(editor))).toBe(true);
    time.elapse(150);
    expect(isArriving(onlyGhost(editor))).toBe(true);
    // The timer redraws it once the entry is 300 ms old.
    time.elapse(160);
    expect(isArriving(onlyGhost(editor))).toBe(false);

    // An entry already older than 300 ms by the editor's clock is drawn without it.
    time.elapse(1000);
    write((file) => file.replace("gone ", ""));
    expect(ghosts(editor).map((ghost) => [ghost.textContent, isArriving(ghost)])).toEqual([
      ["old words ", false],
      ["gone ", false],
    ]);
  });

  it("B13: clearing the log removes every decoration and leaves the text", () => {
    const { view: editor, user, write } = session("one two three\n");
    write("one 2 three and more\n");
    const text = user.text.toString();
    expect(editor.dom.querySelectorAll(".atlas-agent-change, .atlas-agent-ghost").length).toBe(3);
    const seen: number[] = [];
    cleanups.push(observeAgentChanges(user.doc, (changes) => seen.push(changes.length)));

    clearAgentChanges(user.doc);

    expect(seen).toEqual([0]);
    expect(readAgentChanges(user.doc)).toEqual([]);
    expect(editor.dom.querySelectorAll(".atlas-agent-change, .atlas-agent-ghost").length).toBe(0);
    expect(barCount(editor)).toBeNull();
    expect(user.text.toString()).toBe(text);
  });

  it.todo(
    "B14: in the playground, Run turn plays its tool calls while the user types, and the File panel changes only with the agent's writes and the turn's end (browser)",
  );

  it("B15: the log never reaches the text", () => {
    const {
      view: editor,
      user,
      agent,
      write,
      endTurn,
    } = session("keep GHOSTLY words\nand more stuff\n");
    write("keep words\nand more stuff\n");
    write((file) => file.replace("more ", ""));
    const [first, second] = entryIds(user.doc);
    expect(restoreAgentDeletion(editor, second ?? "", 0)).toBe(true);
    expect(user.text.toString()).toBe("keep words\nand more stuff\n");
    // Restored text is the user's: nothing in the note is marked as the agent's.
    expect(highlighted(editor)).toEqual([]);
    expect(dismissAgentDeletion(editor, first ?? "", 0)).toBe(true);
    expect(user.text.toString()).toBe("keep words\nand more stuff\n");
    endTurn();
    write((file) => file.replace("keep ", ""));

    const expected = "words\nand more stuff\n";
    for (const text of [user.text.toString(), agent.text.toString(), editor.state.doc.toString()]) {
      expect(text).toBe(expected);
      for (const leak of ["GHOSTLY", TURN.turnId, TURN.name, TURN.color]) {
        expect(text).not.toContain(leak);
      }
    }
    // The restored deletion is gone from the log; the dismissed one stays for a revert.
    expect(
      readAgentChanges(user.doc).map((entry) =>
        entry.ops.map(({ deleted, dismissed }) => ({ deleted, dismissed })),
      ),
    ).toEqual([
      [{ deleted: "GHOSTLY ", dismissed: true }],
      [{ deleted: "keep ", dismissed: false }],
    ]);
  });
});

describe("agent changes in the live preview", () => {
  const cleanups: (() => void | Promise<void>)[] = [];
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    document.body.innerHTML = "";
  });

  const TURN = { turnId: "turn-1", name: "Agent · turn 1", color: "#7c3aed" };
  const EXTENSIONS = [agentChangeBar()];

  it("B16: a ghost in folded frontmatter is drawn once Next lands the caret there", async () => {
    const initial = "---\ntitle: Note\ntags: [old]\n---\n\n# Body\n\nText.\n";
    const user = peer(1);
    const agent = peer(2);
    user.text.insert(0, initial);
    const userAwareness = new Awareness(user.doc);
    const agentAwareness = new Awareness(agent.doc);
    declareAgent(agentAwareness, TURN);
    applyAwarenessUpdate(
      userAwareness,
      encodeAwarenessUpdate(agentAwareness, [agent.doc.clientID]),
      REMOTE,
    );
    connect(user.doc, agent.doc);

    // The real editor: live preview, Yjs undo, agent changes, as a host mounts it.
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(async () => {
      await act(async () => root.unmount());
      userAwareness.destroy();
      agentAwareness.destroy();
    });
    await act(async () =>
      root.render(
        createElement(AtlasEditor, {
          text: user.text,
          awareness: userAwareness,
          extensions: EXTENSIONS,
        }),
      ),
    );
    const element = host.querySelector<HTMLElement>(".cm-editor");
    const view = element ? EditorView.findFromDOM(element) : null;
    if (!view) throw new Error("AtlasEditor did not mount a view");
    // The user has been in the editor, with the caret in the body.
    view.dispatch({
      selection: { anchor: view.state.doc.length },
      effects: markFocused(),
    });
    finishParse(view);

    applyFileText(agent.text, initial, initial.replace("tags: [old]\n", ""), { log: TURN });
    finishParse(view);

    const frontmatterEnd = "---\ntitle: Note\n".length;
    expect(user.text.toString()).toBe("---\ntitle: Note\n---\n\n# Body\n\nText.\n");
    expect(readAgentChanges(user.doc)[0]?.ops[0]?.from).toBe(frontmatterEnd);
    expect(view.dom.querySelector(".cm-md-properties")).not.toBeNull();
    expect(view.dom.querySelector(".atlas-agent-ghost")).toBeNull();
    expect(view.dom.querySelector(".atlas-agent-bar-count")?.textContent).toBe("1 agent change");

    expect(nextAgentChange(view)).toBe(true);
    finishParse(view);

    expect(view.state.selection.main.head).toBe(frontmatterEnd);
    const ghost = view.dom.querySelector<HTMLElement>(".atlas-agent-ghost");
    expect(ghost?.textContent).toBe("tags: [old]\n");
    ghost?.click();
    expect(document.querySelector(".atlas-agent-ghost-popover")).not.toBeNull();
  });
});
