import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { AppRouteModal } from "../AppRouteModal";
import { CommandDialog, CommandDialogPopup } from "./command";
import { Sheet, SheetPopup } from "./sheet";

// Opens instantly, then stays in its exit transition for the rest of the test.
const HOLD_EXIT = `
  [data-open] { transition: none !important; }
  [data-ending-style] { transition-duration: 1h !important; }
`;

await page.viewport(1400, 900);

const MODALS: ReadonlyArray<{ name: string; slot: string; modal: ReactNode }> = [
  {
    name: "the Settings modal",
    slot: "dialog-popup",
    modal: <AppRouteModal label="Settings">Settings</AppRouteModal>,
  },
  {
    name: "the Search palette",
    slot: "command-dialog-popup",
    modal: (
      <CommandDialog defaultOpen>
        <CommandDialogPopup>Search</CommandDialogPopup>
      </CommandDialog>
    ),
  },
  {
    name: "a sheet",
    slot: "sheet-popup",
    modal: (
      <Sheet defaultOpen>
        <SheetPopup>Details</SheetPopup>
      </Sheet>
    ),
  },
];

it.each(MODALS)("$name lets clicks reach the page while it closes", async ({ slot, modal }) => {
  const onClick = vi.fn();
  await using _screen = await render(
    <>
      <style>{HOLD_EXIT}</style>
      <button className="fixed inset-0" onClick={onClick} type="button">
        Behind
      </button>
      {modal}
    </>,
  );
  const popup = await vi.waitFor(() => {
    const element = document.querySelector(`[data-slot="${slot}"]`);
    expect(element).not.toBeNull();
    return element!;
  });

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(popup.hasAttribute("data-ending-style")).toBe(true));

  const { x, y, width, height } = popup.getBoundingClientRect();
  const behind = page.getByText("Behind");
  // Force: Playwright would otherwise wait out the overlay, which is what a person cannot do.
  await userEvent.click(behind, { force: true, position: { x: 1, y: 1 } });
  await userEvent.click(behind, {
    force: true,
    position: { x: x + width / 2, y: y + height / 2 },
  });

  expect(onClick).toHaveBeenCalledTimes(2);
});
