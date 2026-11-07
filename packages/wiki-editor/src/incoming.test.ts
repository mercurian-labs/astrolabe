import { describe, expect, it } from "vite-plus/test";

import { ambiguousLink, resolveIncomingNote, wikilinkNoteName } from "./incoming";

describe("ambiguousLink", () => {
  it("says which file it chose and which others fit, only when others do", () => {
    expect(ambiguousLink({ file: "a/Plan.md", others: [] })).toBeUndefined();
    expect(ambiguousLink({ file: null, others: [] })).toBeUndefined();
    expect(ambiguousLink({ file: "a/Plan.md", others: ["b/Plan.md"] })).toBe(
      "Goes to a/Plan. Also fits b/Plan.",
    );
    expect(ambiguousLink({ file: "a.md", others: ["b.md", "c.md", "d.md", "e.md", "f.md"] })).toBe(
      "Goes to a. Also fits b, c, d and 2 more.",
    );
  });
});

describe("wikilinkNoteName", () => {
  it("opens the note a link names, whatever heading or alias it carries", () => {
    expect(wikilinkNoteName("Auth\\")).toBe("Auth");
    expect(wikilinkNoteName("Auth\\|the flow")).toBe("Auth");
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
