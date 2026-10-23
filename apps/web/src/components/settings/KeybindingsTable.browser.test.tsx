import "../../index.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, render, type Screen } from "../../../test/render";

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useLocation: (() => "") as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: () => {
    const environment = {
      environmentId: "primary-settings",
      serverConfig: { keybindings: [], keybindingsConfigPath: null, availableEditors: [] },
    };
    return { environment, connectedEnvironments: [environment] } as never;
  },
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
  readEnvironmentScope: (() => true) as never,
  useEnvironmentsWithScope: (() => new Set(["primary-settings"])) as never,
}));
vi.mock(import("../../editorPreferences"), async (original) => ({
  ...(await original()),
  useOpenInPreferredEditor: (() => () => Promise.resolve({ _tag: "Success" })) as never,
}));

import { KeybindingsSettingsPanel } from "./KeybindingsSettings";
import { keybindingSearchAnchorId } from "./settingsSearch";

// Wide enough for the table's columns, which stack below 44rem.
async function renderTable() {
  const container = document.createElement("div");
  container.style.width = "60rem";
  return render(<KeybindingsSettingsPanel />, { container });
}

function commandRow(screen: Screen, command: Parameters<typeof keybindingSearchAnchorId>[0]) {
  const row = screen.container.querySelector<HTMLElement>(
    `[id="${keybindingSearchAnchorId(command)}"]`,
  );
  expect(row).not.toBeNull();
  return row!;
}

function conditionLine(row: HTMLElement, text: string) {
  const line = [...row.querySelectorAll<HTMLElement>("span")].find(
    (span) => span.textContent === text,
  );
  expect(line, `"${text}" under a shortcut`).toBeDefined();
  return line!;
}

describe("the Keybindings table's shortcuts", () => {
  it("say when each applies, as upstream's rows did", async () => {
    await using screen = await renderTable();
    // The same key, told apart by when it applies.
    conditionLine(commandRow(screen, "terminal.close"), "When terminalFocus");
    conditionLine(commandRow(screen, "rightPanel.close"), "When !terminalFocus");
    conditionLine(commandRow(screen, "terminal.toggle"), "Always");
  });

  it("fit the common condition and cut a long one short inside the column, and still open the editor", async () => {
    await using screen = await renderTable();
    const common = conditionLine(commandRow(screen, "rightPanel.close"), "When !terminalFocus");
    expect(common.scrollWidth).toBeLessThanOrEqual(common.clientWidth);
    const row = commandRow(screen, "focus.left");
    const line = conditionLine(row, "When !editableFocus && !terminalFocus");
    expect(line.scrollWidth).toBeGreaterThan(line.clientWidth);
    // The row's second child is its shortcut cell.
    expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(
      row.children[1]!.getBoundingClientRect().right + 0.5,
    );

    const keycaps = row.querySelector<HTMLButtonElement>('button[aria-label^="Edit shortcut for"]');
    expect(keycaps).not.toBeNull();
    await act(async () => keycaps!.click());
    await expect.element(page.getByPlaceholder("Press shortcut")).toBeInTheDocument();
  });
});
