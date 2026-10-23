import { describe, expect, it } from "vite-plus/test";

import { resolveIncomingNote, wikilinkNoteName } from "./incoming";

describe("wikilinkNoteName", () => {
  it("opens the note a link names, whatever heading or alias it carries", () => {
    expect(wikilinkNoteName("Note")).toBe("Note");
    expect(wikilinkNoteName("Note#Heading")).toBe("Note");
    expect(wikilinkNoteName("Note|Alias")).toBe("Note");
    expect(wikilinkNoteName(" #Heading")).toBeNull();
  });
});

describe("resolveIncomingNote", () => {
  it("keeps the buffer when nothing changed underneath", () => {
    expect(resolveIncomingNote({ baseline: "a", buffer: "ab", incoming: "a" })).toBe("keep");
  });
  it("adopts a read that caught up with the buffer", () => {
    expect(resolveIncomingNote({ baseline: "a", buffer: "ab", incoming: "ab" })).toBe("adopt");
  });
  it("reloads a buffer without edits", () => {
    expect(resolveIncomingNote({ baseline: "a", buffer: "a", incoming: "b" })).toBe("reload");
  });
  it("never clobbers edits when the note changed underneath", () => {
    expect(resolveIncomingNote({ baseline: "a", buffer: "ab", incoming: "c" })).toBe("conflict");
  });
});
