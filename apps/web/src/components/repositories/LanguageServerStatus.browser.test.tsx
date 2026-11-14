import type {
  EnvironmentId,
  LanguageServerRoute,
  LanguageServerStatus,
  LanguageServerToolchains,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const shared = vi.hoisted(() => ({ toolchains: null as unknown, tests: 0 }));

vi.mock(import("~/state/languageServers"), async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    languageServersEnvironment: {
      restart: { permissionAtom: () => Atom.make(true) },
      statuses: () => Atom.make(AsyncResult.success([])),
      toolchains: () => Atom.make(AsyncResult.success(shared.toolchains)),
    } as never,
  };
});
vi.mock(import("./languageServerFile"), async (original) => ({
  ...(await original()),
  turnOnLanguageServer: vi.fn(),
  selectInterpreter: vi.fn(),
}));

import { render } from "../../../test/render";
import { LanguageServerStatusEntry } from "./LanguageServerStatus";
import {
  type LanguageServerFile,
  selectInterpreter,
  turnOnLanguageServer,
} from "./languageServerFile";
import "~/index.css";

const status = (patch: Partial<LanguageServerStatus>): LanguageServerStatus => ({
  cwd: "/repo",
  server: "basedpyright",
  name: "basedpyright 1.40.2",
  state: "ready",
  source: "cache",
  restricted: false,
  message: null,
  memoryBytes: null,
  ...patch,
});
const route = (patch: Partial<LanguageServerRoute>): LanguageServerRoute => ({
  server: "basedpyright",
  name: "basedpyright",
  languageId: "python",
  off: false,
  toolchain: "python",
  ...patch,
});
const file = (patch: Partial<LanguageServerFile>): LanguageServerFile => ({
  environmentId: "env" as EnvironmentId,
  cwd: `/repo/${++shared.tests}`,
  server: "basedpyright",
  toolchain: null,
  status: () => null,
  openLogs: vi.fn(),
  openSettings: null,
  ...patch,
});

it("never reads as healthy when its server is off, and offers the way back", async () => {
  await using screen = await render(
    <LanguageServerStatusEntry
      file={file({})}
      status={status({ state: "disabled", message: "Off in settings." })}
      servers={[route({ off: true })]}
    />,
  );
  await expect.element(screen.getByText("basedpyright 1.40.2: Off in settings")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
  expect(vi.mocked(turnOnLanguageServer)).toHaveBeenCalledWith(expect.anything(), "basedpyright");

  await userEvent.click(screen.getByRole("status"));
  await expect.element(page.getByRole("menuitem", { name: "Restart" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("menuitem", { name: "Turn on" })).toBeVisible();
});

it("lists a server turned off beside the one that took over", async () => {
  vi.mocked(turnOnLanguageServer).mockClear();
  await using screen = await render(
    <LanguageServerStatusEntry
      file={file({ server: "ruff" })}
      status={status({ server: "ruff", name: "Ruff 0.17.4" })}
      servers={[route({ server: "ruff", name: "Ruff", toolchain: null }), route({ off: true })]}
    />,
  );
  await userEvent.click(screen.getByRole("status"));
  await expect.element(page.getByText("Off in settings")).toBeVisible();
  await userEvent.click(page.getByRole("menuitem", { name: "Turn on" }));
  expect(vi.mocked(turnOnLanguageServer)).toHaveBeenCalledWith(expect.anything(), "basedpyright");
});

it("shows the active interpreter, and chooses another or goes back to automatic", async () => {
  const venv = { path: "/repo/.venv/bin/python", label: ".venv", version: "3.12.1" };
  const pyenv = { path: "/pyenv/3.11.4/bin/python", label: "pyenv 3.11.4", version: "3.11.4" };
  const found: LanguageServerToolchains = {
    kind: "python",
    selected: null,
    selectedMissing: false,
    active: venv,
    trusted: true,
    options: [venv, pyenv],
  };
  shared.toolchains = found;
  const python = file({ toolchain: "python" });
  await using screen = await render(
    <LanguageServerStatusEntry file={python} status={status({})} servers={[route({})]} />,
  );
  await userEvent.click(screen.getByRole("status"));
  await expect.element(page.getByText(".venv, Python 3.12.1 (automatic)")).toBeVisible();
  await userEvent.click(page.getByRole("menuitem", { name: "Select Python interpreter" }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "pyenv 3.11.4" }));
  expect(vi.mocked(selectInterpreter)).toHaveBeenCalledWith(python, pyenv.path);
});

it("says a chosen interpreter is gone, shows the fallback as automatic, and clears it", async () => {
  vi.mocked(selectInterpreter).mockClear();
  const venv = { path: "/repo/.venv/bin/python", label: ".venv", version: "3.12.1" };
  const found: LanguageServerToolchains = {
    kind: "python",
    selected: "/gone/bin/python",
    selectedMissing: true,
    active: venv,
    trusted: true,
    options: [venv],
  };
  shared.toolchains = found;
  const python = file({ toolchain: "python" });
  await using screen = await render(
    <LanguageServerStatusEntry file={python} status={status({})} servers={[route({})]} />,
  );
  await userEvent.click(screen.getByRole("status"));
  await expect.element(page.getByText(/\.venv, Python 3\.12\.1 \(automatic\)/)).toBeVisible();
  await expect.element(page.getByText(/is gone: \/gone\/bin\/python/)).toBeVisible();
  await userEvent.click(page.getByRole("menuitem", { name: "Clear chosen interpreter" }));
  expect(vi.mocked(selectInterpreter)).toHaveBeenCalledWith(python, null);
});

it("says a chosen interpreter waits for trust", async () => {
  const found: LanguageServerToolchains = {
    kind: "python",
    selected: "/repo/.venv/bin/python",
    selectedMissing: false,
    active: null,
    trusted: false,
    options: [],
  };
  shared.toolchains = found;
  await using screen = await render(
    <LanguageServerStatusEntry
      file={file({ toolchain: "python" })}
      status={status({ restricted: true })}
      servers={[route({})]}
    />,
  );
  await userEvent.click(screen.getByRole("status"));
  await expect.element(page.getByText("Applies once this project is trusted")).toBeVisible();
});
