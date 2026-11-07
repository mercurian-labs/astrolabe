import { linkFiles } from "@mercurian/wiki/resolve-link";
import { WikiLinkPreview } from "@mercurian/wiki-editor/link-tools";
import { WikiNoteBuffer } from "@mercurian/wiki-editor/note-buffer";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { WikiNoteEditor } from "./WikiNoteEditor";
import { WikiPart } from "./WikiParts";

import "~/index.css";

const NOTE = [
  "# Area",
  "",
  "Start with [[Alpha]].",
  "",
  "```base",
  'filters: file.hasTag("area")',
  "```",
  "",
  "After the base.",
].join("\n");

describe("WikiNoteEditor", () => {
  it("shows a ```base block's view inside the note, whose links open notes", async () => {
    const buffer = new WikiNoteBuffer();
    buffer.receive(NOTE);
    const session = buffer.getSnapshot().session!;
    const onOpenNote = vi.fn();
    await using screen = await render(
      <WikiNoteEditor
        session={session}
        readOnly
        onOpenNote={onOpenNote}
        linkTypes={[]}
        renderLinkPreview={() => null}
        renderBase={(source) => (
          <WikiPart.NoteLink
            onClick={() => onOpenNote("Gamma")}
          >{`Rows for ${source}`}</WikiPart.NoteLink>
        )}
      />,
    );
    const view = screen.getByRole("button", { name: 'Rows for filters: file.hasTag("area")' });
    await expect.element(view).toBeVisible();
    await expect.element(screen.getByText("After the base.")).toBeVisible();
    await userEvent.click(view);
    expect(onOpenNote).toHaveBeenCalledWith("Gamma");
    buffer.release();
  });

  it("reads a type where it's written, and hovering a link previews it with all its types", async () => {
    const buffer = new WikiNoteBuffer();
    buffer.receive("Uses [[Auth|the login @depends_on]] and [[Auth#Top|@blocks]].\n");
    await using screen = await render(
      <WikiNoteEditor
        session={buffer.getSnapshot().session!}
        readOnly
        onOpenNote={vi.fn()}
        linkTypes={[]}
        renderLinkPreview={(link) => (
          <WikiLinkPreview link={link} source={"# Auth\n\nSign in with [[Passkeys|a @key]]."} />
        )}
        renderBase={() => null}
      />,
    );
    const word = screen.getByText("depends_on");
    await expect.element(word).toBeVisible();
    await expect.element(screen.getByText("@depends_on")).not.toBeInTheDocument();
    await userEvent.hover(word);
    await expect.element(screen.getByText("Sign in with a key.")).toBeVisible();
    const types = screen.container.querySelectorAll(".cm-wiki-link-preview-type");
    expect([...types].map((type) => type.textContent)).toEqual(["depends_on", "blocks"]);
    buffer.release();
  });

  it("draws a link to nothing red, in code never, and stops once the note exists", async () => {
    const buffer = new WikiNoteBuffer();
    buffer.receive("[[Real]] and [[Gone|the gone one]] and [[pic.png]].\n\n`[[Code]]`\n");
    const editor = (files: ReadonlyArray<string>) => (
      <WikiNoteEditor
        session={buffer.getSnapshot().session!}
        readOnly
        onOpenNote={vi.fn()}
        linkTypes={[]}
        linkScope={{ files: linkFiles(files), from: "Here.md" }}
        renderLinkPreview={() => null}
        renderBase={() => null}
      />
    );
    await using screen = await render(editor(["Real.md"]));
    const red = () =>
      [...screen.container.querySelectorAll(".cm-wiki-link-missing")].map(
        (each) => each.textContent,
      );
    await vi.waitFor(() => expect(red()).toEqual(["the gone one"]));
    await screen.rerender(editor(["Real.md", "Gone.md"]));
    await vi.waitFor(() => expect(red()).toEqual([]));
    buffer.release();
  });

  it.each([
    ["reading", true],
    ["editing", false],
  ])("hovering an ambiguous link while %s says which it took", async (_mode, readOnly) => {
    const buffer = new WikiNoteBuffer();
    buffer.receive("Intro line.\n\nSee [[Name]] here.\n");
    await using screen = await render(
      <WikiNoteEditor
        session={buffer.getSnapshot().session!}
        readOnly={readOnly}
        onOpenNote={vi.fn()}
        linkTypes={[]}
        renderLinkPreview={(link) => (
          <WikiLinkPreview
            link={link}
            source="The chosen one."
            resolved={{ file: "a/Name.md", others: ["b/Name.md"] }}
          />
        )}
        renderBase={() => null}
      />,
    );
    const word = screen.getByText("Name");
    await expect.element(word).toBeVisible();
    await userEvent.hover(word);
    await expect.element(screen.getByText("Goes to a/Name. Also fits b/Name.")).toBeVisible();
    buffer.release();
  });
});
