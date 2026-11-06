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
});
