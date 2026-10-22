import { describe, expect, it } from "vite-plus/test";

import { codeLanguageFor, isMarkdownPath } from "./code";

describe("a repository file's editor", () => {
  it("opens notes with the live preview", () => {
    expect(isMarkdownPath("docs/user/wikis.md")).toBe(true);
    expect(isMarkdownPath("README.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("src/app.ts")).toBe(false);
  });

  it("knows a file's language by its name", () => {
    expect(codeLanguageFor("apps/web/src/main.tsx")?.name).toBe("TSX");
    expect(codeLanguageFor("server/main.py")?.name).toBe("Python");
    expect(codeLanguageFor("notes/unknown.zzz")).toBeNull();
  });
});
