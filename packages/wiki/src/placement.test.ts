// @effect-diagnostics globalDate:off - A stamp is local time, which only a Date reads.
import { describe, expect, it } from "vite-plus/test";

import {
  attachmentFolder,
  attachmentPath,
  canvasFile,
  cleanFileName,
  freePath,
  newNoteFile,
  pastedFileName,
  pastedImageName,
  settingsFolder,
  type WikiPlacement,
} from "./index.ts";

const PLACEMENT: WikiPlacement = {
  attachments: "root",
  attachmentFolder: "att",
  newNotes: "beside",
  newNoteFolder: "",
};

describe("where an attachment lands (ATTACHMENTS-REPORT A1, B)", () => {
  it.each([
    ["root", "att", "a/b/N.md", ""],
    ["root", "att", "N.md", ""],
    ["beside", "att", "a/b/N.md", "a/b"],
    ["beside", "att", "N.md", ""],
    ["beside", "att", "a/b/Board.canvas", "a/b"],
    ["subfolder", "sub", "a/b/N.md", "a/b/sub"],
    ["subfolder", "sub", "N.md", "sub"],
    ["subfolder", "ns/deeper", "a/b/N.md", "a/b/ns/deeper"],
    ["folder", "att", "a/b/N.md", "att"],
    ["folder", "/att/", "N.md", "att"],
    ["folder", "no/such/deep", "a/b/N.md", "no/such/deep"],
    ["folder", "../up", "a/b/N.md", ""],
    ["folder", "..", "a/b/N.md", ""],
    ["subfolder", "../up", "a/b/N.md", "a/b"],
  ] as const)("%s %s from %s lands in %j", (attachments, folder, source, landing) => {
    expect(attachmentFolder({ ...PLACEMENT, attachments, attachmentFolder: folder }, source)).toBe(
      landing,
    );
  });

  it("names a pasted image by the stamp and its type, in local time", () => {
    const at = new Date(2026, 10, 6, 23, 5, 29);
    expect(pastedImageName("image/png", at)).toBe("Pasted image 20261106230529.png");
    expect(pastedFileName({ name: "image.png", type: "image/jpeg" }, at)).toBe(
      "Pasted image 20261106230529.jpg",
    );
    expect(pastedFileName({ name: "photo.png", type: "image/png" }, at)).toBe(
      "Pasted image 20261106230529.png",
    );
    expect(pastedFileName({ name: "x.gif", type: "image/gif" }, at)).toBe("x.gif");
    expect(pastedFileName({ name: "x.pdf", type: "application/pdf" }, at)).toBe("x.pdf");
  });

  it.each([
    ["odd#na^me[1].png", "odd na me[1].png"],
    ["p|q.png", "p q.png"],
    ["photo one.png", "photo one.png"],
  ])("cleans %s", (name, clean) => {
    expect(cleanFileName(name)).toBe(clean);
  });

  it.each([
    ["photo.png", ["photo.png"], "photo 1.png"],
    ["photo.png", ["photo.png", "photo 1.png", "photo 3.png"], "photo 2.png"],
    ["PHOTO.png", ["photo.png", "photo 1.png"], "PHOTO 2.png"],
    ["a/photo.png", ["photo.png", "b/photo.png"], "a/photo.png"],
    ["Pasted image 2026.png", ["Pasted image 2026.png"], "Pasted image 2026 1.png"],
    ["noextension", ["noextension"], "noextension 1"],
  ])("frees %s among %j", (file, files, free) => {
    expect(freePath(file, files)).toBe(free);
  });

  it("puts name, folder and clash together", () => {
    const placement: WikiPlacement = { ...PLACEMENT, attachments: "beside" };
    expect(attachmentPath(placement, "a/N.md", "x#y.png")).toBe("a/x y.png");
    expect(attachmentPath(placement, null, "x.png")).toBe("x.png");
  });
});

describe("where a new note lands (ATTACHMENTS-REPORT C, LINKS-REPORT A5, rule 12)", () => {
  const files = ["cf/Note.md", "b/Other.md"];
  const beside = PLACEMENT;
  const root: WikiPlacement = { ...PLACEMENT, newNotes: "root" };
  const folder: WikiPlacement = { ...PLACEMENT, newNotes: "folder", newNoteFolder: "cf" };
  const missing: WikiPlacement = { ...PLACEMENT, newNotes: "folder", newNoteFolder: "inbox/deep" };

  it.each([
    ["S", beside, "a/b/Deep.md", "a/b/S.md"],
    ["S", beside, null, "S.md"],
    ["S", beside, "Root.md", "S.md"],
    ["S", beside, "a/b/Board.canvas", "a/b/S.md"],
    ["S", root, "a/b/Deep.md", "S.md"],
    ["S", folder, "a/b/Deep.md", "cf/S.md"],
    ["S", missing, "a/b/Deep.md", "S.md"],
    ["S.md", root, "a/Deep.md", "S.md"],
    ["S#Heading|alias", beside, "a/Deep.md", "a/S.md"],
    ["x/S", beside, "a/b/Deep.md", "x/S.md"],
    ["nofold2/deeper/S", folder, "c/L.md", "nofold2/deeper/S.md"],
    ["deep/S", beside, "a/deep/L.md", "deep/S.md"],
    ["/S", beside, "a/L.md", "S.md"],
    ["/x/S", root, "a/L.md", "x/S.md"],
    ["Plan.canvas", root, null, "Plan.canvas"],
    ["./S", beside, "a/L.md", null],
    ["../S", beside, "a/L.md", null],
    ["./x/S", beside, "a/L.md", null],
    ["x/../S", beside, "a/L.md", null],
    [".git/S", beside, null, null],
    ["", beside, null, null],
  ] as const)("%s, %o, from %s lands at %j", (target, placement, from, file) => {
    expect(newNoteFile(target, from, placement, files)).toBe(file);
  });

  it.each([
    ["Board", "Board.canvas"],
    [" Board.canvas ", "Board.canvas"],
    ["ops/deep/Board", "ops/deep/Board.canvas"],
    ["/ops/Board", "ops/Board.canvas"],
    ["", null],
    ["ops/", null],
    ["../Board", null],
    ["a/../Board", null],
    [".git/Board", null],
  ] as const)("keeps a canvas typed as %j at %j", (name, file) => {
    expect(canvasFile(name)).toBe(file);
  });

  it("reads a folder from settings, refusing .. and anything else no wiki holds", () => {
    expect(settingsFolder(" /att/ ")).toBe("att");
    expect(settingsFolder("./sub")).toBe("sub");
    expect(settingsFolder("")).toBe("");
    expect(settingsFolder("/")).toBe("");
    expect(settingsFolder("../up")).toBeNull();
    expect(settingsFolder("a/../b")).toBeNull();
    expect(settingsFolder(".git")).toBeNull();
  });
});
