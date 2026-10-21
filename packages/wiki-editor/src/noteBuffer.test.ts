import { afterEach, describe, expect, it } from "vite-plus/test";

import { WikiNoteBuffer } from "./noteBuffer";

const buffers: WikiNoteBuffer[] = [];
function makeBuffer(source: string) {
  const buffer = new WikiNoteBuffer();
  buffers.push(buffer);
  buffer.receive(source);
  return buffer;
}
function type(buffer: WikiNoteBuffer, text: string) {
  const session = buffer.getSnapshot().session!;
  session.text.insert(session.text.length, text);
}

afterEach(() => {
  for (const buffer of buffers.splice(0)) buffer.release();
});

describe("WikiNoteBuffer", () => {
  it("seeds the editor with the first read and tracks edits against it", () => {
    const buffer = makeBuffer("Hello");
    expect(buffer.getSnapshot().session?.text.toString()).toBe("Hello");
    expect(buffer.getSnapshot().dirty).toBe(false);
    type(buffer, " world");
    expect(buffer.getSnapshot().dirty).toBe(true);
  });

  it("reloads a clean buffer when the note changes on the server", () => {
    const buffer = makeBuffer("v1");
    const first = buffer.getSnapshot().session;
    buffer.receive("v2");
    const snapshot = buffer.getSnapshot();
    expect(snapshot.session).not.toBe(first);
    expect(snapshot.session?.text.toString()).toBe("v2");
    expect(snapshot.changedUnderneath).toBe(false);
  });

  it("keeps unsaved edits when the note changes underneath, until the person chooses", () => {
    const buffer = makeBuffer("v1");
    type(buffer, " mine");
    buffer.receive("v2");
    expect(buffer.current()).toBe("v1 mine");
    expect(buffer.getSnapshot().changedUnderneath).toBe(true);
    buffer.loadChanged();
    expect(buffer.current()).toBe("v2");
    expect(buffer.getSnapshot()).toMatchObject({ dirty: false, changedUnderneath: false });
  });

  it("treats its own saved text coming back as no change, even after more typing", () => {
    const buffer = makeBuffer("v1");
    type(buffer, " saved");
    buffer.markSaved(buffer.current());
    type(buffer, " more");
    buffer.receive("v1 saved");
    expect(buffer.current()).toBe("v1 saved more");
    expect(buffer.getSnapshot()).toMatchObject({ dirty: true, changedUnderneath: false });
  });

  it("discards edits back to the loaded text", () => {
    const buffer = makeBuffer("v1");
    type(buffer, " oops");
    buffer.discard();
    expect(buffer.current()).toBe("v1");
    expect(buffer.getSnapshot().dirty).toBe(false);
  });
});

describe("WikiNoteBuffer live amendments", () => {
  const author = { name: "claude", color: "#d946ef", turnId: "run-1" };
  const changeLog = (buffer: WikiNoteBuffer) =>
    buffer.getSnapshot().session!.doc.getArray("agentChanges").length;

  it("lands an amendment in the open document, attributed, without remounting", () => {
    const buffer = makeBuffer("The cat sat.");
    const session = buffer.getSnapshot().session;
    buffer.receive("The cat sat on the mat.", author);
    expect(buffer.getSnapshot().session).toBe(session);
    expect(buffer.current()).toBe("The cat sat on the mat.");
    expect(buffer.getSnapshot().dirty).toBe(false);
    expect(changeLog(buffer)).toBe(1);
  });

  it("keeps what the person typed mid-turn, and only that counts as unsaved", () => {
    const buffer = makeBuffer("Alpha.\n\nBeta.");
    type(buffer, "\n\nMine.");
    buffer.receive("Alpha, rewritten.\n\nBeta.", author);
    expect(buffer.current()).toBe("Alpha, rewritten.\n\nBeta.\n\nMine.");
    expect(buffer.getSnapshot()).toMatchObject({ dirty: true, changedUnderneath: false });
  });

  it("diffs each write against the agent's previous write, not the buffer", () => {
    const buffer = makeBuffer("one");
    buffer.receive("one two", author);
    buffer.getSnapshot().session!.text.insert(0, "mine ");
    buffer.receive("one two three", author);
    expect(buffer.current()).toBe("mine one two three");
    expect(changeLog(buffer)).toBe(2);
  });

  it("ignores the person's own save coming back", () => {
    const buffer = makeBuffer("v1");
    type(buffer, " saved");
    buffer.markSaved(buffer.current());
    buffer.receive("v1 saved", author);
    expect(changeLog(buffer)).toBe(0);
    expect(buffer.getSnapshot().dirty).toBe(false);
  });
});
