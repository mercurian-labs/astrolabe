import { describe, expect, it } from "vite-plus/test";

import { ambiguousLink, resolveIncomingNote, wikiEmbeds, wikilinkNoteName } from "./incoming";

describe("wikiEmbeds", () => {
  it("holds one address per target until it runs out, and a missing one for a while", async () => {
    let time = 0;
    const asked: string[] = [];
    const resolve = wikiEmbeds(
      async (target) => {
        asked.push(target);
        return target === "gone.png"
          ? { url: null, expiresAt: 0 }
          : { url: `/${asked.length}`, expiresAt: 1_000 };
      },
      () => time,
    );

    const first = resolve("a.png");
    expect(resolve("a.png")).toBe(first);
    expect(await first).toBe("/1");
    expect(await resolve("a.png")).toBe("/1");
    expect(await resolve("gone.png")).toBeNull();
    expect(await resolve("gone.png")).toBeNull();
    expect(asked).toEqual(["a.png", "gone.png"]);

    time = 1_000;
    expect(await resolve("a.png")).toBe("/3");
    expect(asked).toEqual(["a.png", "gone.png", "a.png"]);
    time = 60_001;
    await resolve("gone.png");
    expect(asked).toHaveLength(4);
  });
});

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
