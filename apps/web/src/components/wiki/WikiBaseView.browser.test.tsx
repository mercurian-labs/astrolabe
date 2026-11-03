import type { EnvironmentId, WikiId, WikiQueryResult } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { WikiBaseResults } from "./WikiBaseView";

import "~/index.css";

const at = { environmentId: "env-1" as EnvironmentId, wikiId: "wiki-1" as WikiId };

const result = (overrides: Partial<WikiQueryResult>): WikiQueryResult => ({
  commit: "4f1c2a9",
  view: { name: "Open", type: "table" },
  views: ["Open"],
  columns: [
    { id: "status", label: "Status" },
    { id: "owner", label: "Owner" },
  ],
  groupBy: null,
  rows: [
    { name: "Alpha", file: "Alpha.md", values: { status: "open", owner: "[[Venkat|V]]" } },
    { name: "Beta", file: "Beta.md", values: { status: "done", owner: null } },
  ],
  total: 2,
  truncated: false,
  ...overrides,
});

describe("WikiBaseResults", () => {
  it("opens each row's note from its name, even in a view that shows no name column", async () => {
    const onOpenNote = vi.fn();
    await using screen = await render(
      <WikiBaseResults {...at} result={result({})} onOpenNote={onOpenNote} />,
    );
    await expect.element(screen.getByText("Name", { exact: true })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Beta" }));
    await userEvent.click(screen.getByRole("button", { name: "V" }));
    expect(onOpenNote.mock.calls).toEqual([["Beta"], ["Venkat"]]);
  });

  it("opens a file that is no wiki document as a file, and shows the view's summaries", async () => {
    const onOpenNote = vi.fn();
    const onOpenFile = vi.fn();
    const files = result({
      columns: [
        { id: "file.name", label: "file name" },
        { id: "file.size", label: "file size" },
      ],
      rows: [
        { name: "pic.png", file: "attachments/pic.png", values: { "file.size": 70 } },
        { name: "Open.base", file: "Open.base", values: { "file.size": 30 } },
      ],
      summaries: [{ column: "file.size", name: "Sum", value: "100" }],
    });
    await using screen = await render(
      <WikiBaseResults {...at} result={files} onOpenNote={onOpenNote} onOpenFile={onOpenFile} />,
    );
    await expect.element(screen.getByText("Summary", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("100", { exact: true })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "pic.png" }));
    await userEvent.click(screen.getByRole("button", { name: "Open.base" }));
    expect(onOpenFile.mock.calls).toEqual([["attachments/pic.png"]]);
    expect(onOpenNote.mock.calls).toEqual([["Open.base"]]);
  });

  it("heads each group of a grouped view, and opens notes from cards", async () => {
    const onOpenNote = vi.fn();
    const grouped = result({
      view: { name: "Board", type: "cards" },
      groupBy: { id: "status", label: "Status" },
      rows: [
        { name: "Beta", file: "Beta.md", values: { status: "done" }, group: "done" },
        { name: "Alpha", file: "Alpha.md", values: { status: "open" }, group: "open" },
        { name: "Gamma", file: "Gamma.md", values: { status: null }, group: null },
      ],
      total: 40,
      truncated: true,
    });
    await using screen = await render(
      <WikiBaseResults {...at} result={grouped} onOpenNote={onOpenNote} />,
    );
    for (const heading of ["done", "open", "None"]) {
      await expect
        .element(screen.getByRole("heading", { name: new RegExp(`^${heading}`) }))
        .toBeVisible();
    }
    await expect.element(screen.getByText("Showing 3 of 40 results.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Gamma" }));
    expect(onOpenNote).toHaveBeenCalledWith("Gamma");
  });

  it("lists a list view's rows with their properties after the name", async () => {
    const list = result({ view: { name: "List", type: "list" } });
    await using screen = await render(
      <WikiBaseResults {...at} result={list} onOpenNote={vi.fn()} />,
    );
    await expect.element(screen.getByRole("listitem").first()).toHaveTextContent("Alpha, open, V");
  });

  it("draws checkboxes, local dates and errors as Obsidian does", async () => {
    const rich = result({
      columns: [
        { id: "done", label: "done" },
        { id: "due", label: "due" },
        { id: "formula.bad", label: "bad" },
      ],
      rows: [
        {
          name: "Alpha",
          file: "Alpha.md",
          values: { done: true, due: "2024-02-29", "formula.bad": "Error: Expected File" },
          display: {
            due: { kind: "date", date: "2024-02-29" },
            "formula.bad": { kind: "error", message: "Expected File" },
          },
        },
      ],
    });
    await using screen = await render(
      <WikiBaseResults {...at} result={rich} onOpenNote={vi.fn()} />,
    );
    await expect.element(screen.getByRole("checkbox")).toBeChecked();
    await expect
      .element(
        screen.getByText(
          new Date(2024, 1, 29).toLocaleDateString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }),
        ),
      )
      .toBeVisible();
    await expect.element(screen.getByText("Expected File", { exact: true })).toBeVisible();
  });

  it("edits a note's property in place, as a change the page holds", async () => {
    const onEdit = vi.fn();
    await using screen = await render(
      <WikiBaseResults
        {...at}
        result={result({})}
        onOpenNote={vi.fn()}
        editing={{
          file: "Open.base",
          edits: [],
          view: null,
          onPickView: vi.fn(),
          onEdit,
          onUndo: vi.fn(),
          onNew: vi.fn(),
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit status of Alpha" }));
    const input = screen.getByRole("textbox", { name: "status of Alpha" });
    await userEvent.clear(input);
    await userEvent.type(input, "closed{Enter}");
    expect(onEdit).toHaveBeenCalledWith({
      kind: "property",
      file: "Alpha.md",
      property: "status",
      value: "closed",
    });
  });
});
