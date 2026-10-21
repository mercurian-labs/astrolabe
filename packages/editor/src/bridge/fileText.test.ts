import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { applyFileText, fileTextTarget } from "./fileText.ts";
import { readAgentChanges } from "../collab/changeLog.ts";

function note(initial: string) {
  const doc = new Y.Doc();
  const text = doc.getText("note");
  text.insert(0, initial);
  let transactions = 0;
  doc.on("afterTransaction", () => {
    transactions += 1;
  });
  return { doc, text, transactions: () => transactions };
}

describe("applyFileText", () => {
  it("does nothing when the file text is unchanged", () => {
    const { text, transactions } = note("# Title\n\nBody\n");

    expect(applyFileText(text, "# Title\n\nBody\n", "# Title\n\nBody\n")).toBeNull();
    expect(transactions()).toBe(0);
  });

  it("applies a single insert and returns the end of the inserted text", () => {
    const { text, transactions } = note("alpha|gamma");

    const end = applyFileText(text, "alpha|gamma", "alpha|beta|gamma");

    expect(text.toString()).toBe("alpha|beta|gamma");
    expect(end).toBe("alpha|beta|".length);
    expect(transactions()).toBe(1);
  });

  it("applies a single delete", () => {
    const { text } = note("alpha-beta+gamma");

    const end = applyFileText(text, "alpha-beta+gamma", "alpha+gamma");

    expect(text.toString()).toBe("alpha+gamma");
    expect(end).toBe("alpha".length);
  });

  it("replaces text in the middle as one transaction", () => {
    const { text, transactions } = note("one two three");

    applyFileText(text, "one two three", "one 2 three");

    expect(text.toString()).toBe("one 2 three");
    expect(transactions()).toBe(1);
  });

  it("keeps relative positions outside the edit on the same characters", () => {
    const { doc, text } = note("keep this, change that, keep the rest");
    const before = Y.createRelativePositionFromTypeIndex(text, "keep ".length);
    const after = Y.createRelativePositionFromTypeIndex(text, text.toString().indexOf("rest"));

    applyFileText(
      text,
      "keep this, change that, keep the rest",
      "keep this, rewrite it all, keep the rest",
    );

    const resolvedBefore = Y.createAbsolutePositionFromRelativePosition(before, doc);
    const resolvedAfter = Y.createAbsolutePositionFromRelativePosition(after, doc);
    expect(text.toString()).toBe("keep this, rewrite it all, keep the rest");
    expect(resolvedBefore?.index).toBe("keep ".length);
    expect(text.toString().slice(resolvedAfter?.index)).toBe("rest");
  });

  it("maps the file change onto text the user has edited since the last flush", () => {
    const { text } = note("intro\nagent section\n");
    // The user types before the agent's file write reaches the document.
    text.insert(0, "user: ");

    const end = applyFileText(text, "intro\nagent section\n", "intro\nagent section, revised\n");

    expect(text.toString()).toBe("user: intro\nagent section, revised\n");
    expect(end).toBe("user: intro\nagent section, revised".length);
  });

  it("drops a user edit inside a region the file write deletes", () => {
    const { text } = note("abcd");
    text.insert(2, "X");

    applyFileText(text, "abcd", "ad");

    // The file write owns "bc", so the user's "X" typed between them goes with it.
    expect(text.toString()).toBe("ad");
    expect(text.toString()).not.toContain("X");
  });

  it("shifts a user edit after the changed region", () => {
    const { doc, text } = note("one two three");
    text.insert(text.length, "!");
    const bang = Y.createRelativePositionFromTypeIndex(text, "one two three".length);

    const end = applyFileText(text, "one two three", "one 2 three");

    expect(text.toString()).toBe("one 2 three!");
    expect(end).toBe("one 2".length);
    expect(Y.createAbsolutePositionFromRelativePosition(bang, doc)?.index).toBe(
      "one 2 three".length,
    );
  });

  it("applies two file edits around a user edit between them", () => {
    const { text } = note("alpha|beta|gamma");
    text.insert("alpha|".length, "user ");

    const end = applyFileText(text, "alpha|beta|gamma", "ALPHA|beta|GAMMA");

    expect(text.toString()).toBe("ALPHA|user beta|GAMMA");
    expect(end).toBe("ALPHA|user beta|GAMMA".length);
  });

  describe("fileTextTarget", () => {
    it("maps the first edit onto a buffer the user has typed into, without applying it", () => {
      const { text, transactions } = note("intro\nagent section\n");
      text.insert(0, "user: ");
      const typed = transactions();

      const target = fileTextTarget(
        text,
        "intro\nagent section\n",
        "intro\nagent section, revised\n",
      );

      expect(target).toBe("user: intro\nagent section".length);
      expect(text.toString()).toBe("user: intro\nagent section\n");
      expect(transactions()).toBe(typed);
      // It is where the write then makes its first edit.
      applyFileText(text, "intro\nagent section\n", "intro\nagent section, revised\n");
      expect(text.toString().slice(target ?? 0)).toBe(", revised\n");
    });

    it("is null when the file text is unchanged", () => {
      const { text } = note("# Title\n");

      expect(fileTextTarget(text, "# Title\n", "# Title\n")).toBeNull();
    });
  });

  describe("with a change log", () => {
    const AUTHOR = { turnId: "turn-1", name: "Agent · turn 1", color: "#7c3aed" };
    const REMOTE = Symbol("remote");

    /** The user's note and an agent peer relaying to it, as a provider would. */
    function peers(initial: string) {
      const user = note(initial);
      const agentDoc = new Y.Doc();
      const agentText = agentDoc.getText("note");
      Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(user.doc), REMOTE);
      agentDoc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin !== REMOTE) Y.applyUpdate(user.doc, update, REMOTE);
      });
      user.doc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin !== REMOTE) Y.applyUpdate(agentDoc, update, REMOTE);
      });
      return { ...user, agentDoc, agentText };
    }

    /** The Yjs item id of each live character of `text`, as `client:clock`. */
    function characterIds(text: Y.Text) {
      const ids: string[] = [];
      for (let item = text._start; item !== null; item = item.right) {
        if (item.deleted || !item.countable) continue;
        for (let i = 0; i < item.length; i += 1) ids.push(`${item.id.client}:${item.id.clock + i}`);
      }
      return ids;
    }

    it("records nothing without a log", () => {
      const { text, doc } = note("one two three");

      applyFileText(text, "one two three", "one 2 three");

      expect(readAgentChanges(doc)).toEqual([]);
    });

    it("B8: records one entry per write, in the write's own transaction", () => {
      const { doc, agentDoc, agentText, transactions } = peers("one two three\nfour\n");
      const clockBefore = Y.getState(agentDoc.store, agentDoc.clientID);

      const end = applyFileText(agentText, "one two three\nfour\n", "one 2 three\n", {
        log: AUTHOR,
      });

      expect(end).toBe("one 2 three\n".length);
      expect(transactions()).toBe(1);
      const [entry, ...rest] = readAgentChanges(doc);
      expect(rest).toEqual([]);
      expect(entry).toMatchObject({
        turnId: "turn-1",
        client: agentDoc.clientID,
        name: "Agent · turn 1",
        color: "#7c3aed",
        // The write inserted one character ("2"), so it spans one clock.
        clock: { from: clockBefore, to: clockBefore + 1 },
      });
      expect(
        entry?.ops.map(({ from, to, assoc, deleted }) => ({ from, to, assoc, deleted })),
      ).toEqual([
        { from: 4, to: 5, assoc: 1, deleted: "two" },
        // An anchor at the end of the text sticks to the character before it.
        { from: 12, to: 12, assoc: -1, deleted: "four\n" },
      ]);

      applyFileText(agentText, "one 2 three\n", "one 2 three\nfive\n", { log: AUTHOR });

      // The ghost of "four" stays where it was rather than following the appended line.
      expect(readAgentChanges(doc).map((change) => change.ops)).toEqual([
        entry?.ops,
        [
          {
            from: 12,
            to: 17,
            assoc: 1,
            anchor: { client: agentDoc.clientID, clock: clockBefore + 2 },
            deleted: "",
            items: [],
            dismissed: false,
          },
        ],
      ]);
    });

    it("B6: the deleted text is the buffer's, with the user's unsent characters in it", () => {
      const { text, doc, agentText } = peers("Intro.\nThe quick fox jumps.\nOutro.\n");
      text.insert("Intro.\nThe quick ".length, "mine ");

      applyFileText(
        agentText,
        "Intro.\nThe quick fox jumps.\nOutro.\n",
        "Intro.\nAgents replace whole sentences now.\nOutro.\n",
        { log: AUTHOR },
      );

      expect(text.toString()).toBe("Intro.\nAgents replace whole sentences now.\nOutro.\n");
      expect(readAgentChanges(doc)[0]?.ops.map((op) => op.deleted)).toEqual([
        "The quick mine fox jumps",
      ]);
    });

    it("records the origin of every deleted character, by client and clock", () => {
      const { text, doc, agentDoc, agentText } = peers("start\n");
      const clockBefore = Y.getState(agentDoc.store, agentDoc.clientID);
      applyFileText(agentText, "start\n", "start alpha\n", { log: AUTHOR });
      const userClock = Y.getState(doc.store, doc.clientID);
      text.insert("start al".length, "X");

      applyFileText(agentText, "start alpha\n", "start\n", { log: AUTHOR });

      expect(text.toString()).toBe("start\n");
      // " al" and "pha" came from the first write's clocks, "X" from the user's.
      const [op] = readAgentChanges(doc)[1]?.ops ?? [];
      expect(op).toMatchObject({ from: 5, to: 5, assoc: 1, deleted: " alXpha" });
      expect(op?.items).toEqual([
        { at: 0, length: 3, client: agentDoc.clientID, clock: clockBefore },
        { at: 3, length: 1, client: doc.clientID, clock: userClock },
        { at: 4, length: 3, client: agentDoc.clientID, clock: clockBefore + 3 },
      ]);
    });

    it("keeps an op anchored while the user types around it", () => {
      const { text, doc, agentText } = peers("alpha omega");
      applyFileText(agentText, "alpha omega", "alpha beta omega", { log: AUTHOR });

      text.insert(0, ">> ");
      // Typing at the end of the insertion ("beta ") does not grow it.
      text.insert(">> alpha beta ".length, "!");

      expect(text.toString()).toBe(">> alpha beta !omega");
      expect(readAgentChanges(doc)[0]?.ops).toMatchObject([
        { from: ">> alpha ".length, to: ">> alpha beta ".length, assoc: 1, deleted: "" },
      ]);
    });

    it.each([
      ["without a log", undefined],
      ["with a log", AUTHOR],
    ])("B17: an insertion keeps the user's characters and the untouched items, %s", (_how, log) => {
      const { text, agentText } = peers("cat");
      text.insert(1, "X");
      const before = characterIds(text);

      applyFileText(agentText, "cat", "cats", log ? { log } : {});

      expect(text.toString()).toBe("cXats");
      // Every character but the inserted "s" is the same Yjs item it was.
      expect(characterIds(text).slice(0, 4)).toEqual(before);
    });

    it("B17: a rewritten sentence is a few ops, not one per shared letter", () => {
      const { doc, agentText } = peers(
        "> Agents write through the file bridge, as a minimal diff against the last flushed text.\n",
      );

      applyFileText(
        agentText,
        "> Agents write through the file bridge, as a minimal diff against the last flushed text.\n",
        "> Agents write files; the bridge turns each write into one Yjs transaction.\n",
        { log: AUTHOR },
      );

      // A plain character diff makes about forty ops of this; the semantic cleanup, one.
      expect(readAgentChanges(doc)[0]?.ops.map((op) => op.deleted)).toEqual([
        "through the file bridge, as a minimal diff against the last flushed text",
      ]);
    });

    it("B15: the log never reaches the text", () => {
      const { text, agentText } = peers("keep SECRET words\n");

      applyFileText(agentText, "keep SECRET words\n", "keep words\n", { log: AUTHOR });

      expect(text.toString()).toBe("keep words\n");
      expect(agentText.toString()).toBe("keep words\n");
    });
  });
});
