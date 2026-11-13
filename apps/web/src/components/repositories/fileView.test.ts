import { describe, expect, it } from "vite-plus/test";

import { fileAssetResource, fileView } from "./fileView";

describe("fileView", () => {
  it.each([
    ["clip.mp4", { kind: "video" }],
    ["clip.webm", { kind: "video" }],
    ["song.mp3", { kind: "audio" }],
    ["photo.PNG", { kind: "image" }],
    ["logo.svg", { kind: "image" }],
    ["docs/spec.pdf", { kind: "pdf" }],
    ["report.docx", { kind: "document" }],
    ["sheet.xlsx", { kind: "document" }],
    ["analysis.ipynb", { kind: "document" }],
    ["font.woff2", { kind: "document" }],
    ["bundle.zip", { kind: "document" }],
    ["state.sqlite", { kind: "document" }],
    ["data.csv", { kind: "text", rendered: "table" }],
    ["data.TSV", { kind: "text", rendered: "table" }],
    ["flow.mmd", { kind: "text", rendered: "mermaid" }],
    ["index.html", { kind: "text", rendered: "html" }],
    ["page.htm", { kind: "text", rendered: "html" }],
    ["README.md", { kind: "text", rendered: null }],
    ["src/main.ts", { kind: "text", rendered: null }],
    ["Makefile", { kind: "text", rendered: null }],
    ["program.bin", { kind: "text", rendered: null }],
  ])("%s", (path, expected) => {
    expect(fileView(path)).toEqual(expected);
  });
});

describe("fileAssetResource", () => {
  const cwd = "/repo";
  it.each([
    ["src/a.png", "show", { _tag: "draft-workspace-file", cwd, path: "src/a.png" }],
    [
      "big.log",
      "download",
      { _tag: "draft-workspace-file", cwd, path: "big.log", disposition: "attachment" },
    ],
  ] as const)("%s as %s", (path, use, expected) => {
    expect(fileAssetResource({ cwd, path }, use)).toEqual(expected);
  });
});
