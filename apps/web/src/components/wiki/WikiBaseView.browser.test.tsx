import type { WikiQueryResult } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { WikiBaseResults } from "./WikiBaseView";

import "~/index.css";

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
      <WikiBaseResults result={result({})} onOpenNote={onOpenNote} />,
    );
    await expect.element(screen.getByText("Name", { exact: true })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Beta" }));
    await userEvent.click(screen.getByRole("button", { name: "V" }));
    expect(onOpenNote.mock.calls).toEqual([["Beta"], ["Venkat"]]);
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
    await using screen = await render(<WikiBaseResults result={grouped} onOpenNote={onOpenNote} />);
    for (const heading of ["Status: done", "Status: open", "Status: None"]) {
      await expect.element(screen.getByText(heading)).toBeVisible();
    }
    await expect.element(screen.getByText("Showing 3 of 40 notes.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Gamma" }));
    expect(onOpenNote).toHaveBeenCalledWith("Gamma");
  });
});
