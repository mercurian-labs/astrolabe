import type { WikiQueryResult } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { WikiBaseToolbar } from "./WikiBaseToolbar";

import "~/index.css";

const result: WikiQueryResult = {
  commit: "4f1c2a9",
  view: { name: "Open", type: "table" },
  views: ["Open", "Board"],
  columns: [{ id: "status", label: "status" }],
  groupBy: null,
  rows: [],
  total: 0,
  truncated: false,
};

const toolbar = (onPickView = vi.fn(), onEdit = vi.fn()) => (
  <WikiBaseToolbar
    result={result}
    file="Work.base"
    onPickView={onPickView}
    onEdit={onEdit}
    onNew={vi.fn()}
  />
);

describe("WikiBaseToolbar", () => {
  it("closes the view menu once a view is picked", async () => {
    const onPickView = vi.fn();
    await using screen = await render(toolbar(onPickView));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(page.getByRole("menuitemradio", { name: "Board" }));
    expect(onPickView).toHaveBeenCalledWith("Board");
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  });

  it("renames a view in a dialog that outlives the menu closing", async () => {
    const onPickView = vi.fn();
    const onEdit = vi.fn();
    await using screen = await render(toolbar(onPickView, onEdit));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Rename view" }));
    const name = page.getByRole("textbox", { name: "View name" });
    await expect.element(name).toHaveValue("Open");
    await userEvent.clear(name);
    await userEvent.type(name, "Live{Enter}");
    expect(onEdit).toHaveBeenCalledWith({
      kind: "view",
      base: "Work.base",
      view: "Open",
      name: "Live",
    });
    expect(onPickView).toHaveBeenCalledWith("Live");
  });
});
