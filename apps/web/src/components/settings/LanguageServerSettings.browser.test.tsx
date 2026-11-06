import {
  EnvironmentId,
  type LanguageServerCheck,
  type LanguageServerCheckResult,
  type LanguageServerUpdateSettingsInput,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const shared = vi.hoisted(() => ({
  results: new Map<string, unknown>(),
  update: null as ((input: unknown) => Promise<unknown>) | null,
}));

vi.mock(import("../../state/languageServers"), async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const guarded = { permissionAtom: () => Atom.make(true) };
  const atoms = new Map<string, unknown>();
  return {
    languageServersEnvironment: {
      trustProject: guarded,
      revokeProjectTrust: guarded,
      updateSettings: guarded,
      check: (_environmentId: string, cwd: string) => {
        const atom =
          atoms.get(cwd) ?? Atom.make(() => AsyncResult.success(shared.results.get(cwd)));
        atoms.set(cwd, atom);
        return atom;
      },
    } as never,
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => (input: unknown) => shared.update?.(input)) as never,
}));

import { render } from "../../../test/render";
import { LanguageServerProjectSettings } from "./LanguageServerSettings";
import "~/index.css";

const environmentId = EnvironmentId.make("env");
const check = (patch: Partial<LanguageServerCheck>): LanguageServerCheck => ({
  server: "basedpyright",
  languages: "Python",
  name: "basedpyright 1.40.2",
  state: "found",
  source: "cache",
  executable: "/cache/basedpyright",
  message: null,
  companion: null,
  off: false,
  language: "basedpyright",
  overrides: [],
  replacedBy: [],
  ...patch,
});
const RUFF = check({
  server: "ruff",
  name: "Ruff 0.17.4",
  companion: { active: true, reason: "Runs on every Python file." },
});
const EMPTY = { servers: {}, order: {} };

let tests = 0;

/** The section on a checkout of its own, and the changes it asks for. */
async function setup(result: Partial<LanguageServerCheckResult> = {}) {
  const cwd = `/repo/${++tests}`;
  shared.results.set(cwd, {
    trusted: true,
    servers: [check({}), RUFF],
    settings: { machine: EMPTY, project: EMPTY, custom: [] },
    projectFile: { path: ".astrolabe/language-servers.json", read: false, problem: null },
    settingsProblem: null,
    ...result,
  });
  const changes: Array<LanguageServerUpdateSettingsInput["change"]> = [];
  shared.update = async (input) => {
    changes.push((input as { input: LanguageServerUpdateSettingsInput }).input.change);
    return { _tag: "Success" };
  };
  const members = [{ environmentId, workspaceRoot: cwd, environmentLabel: null }];
  const screen = await render(<LanguageServerProjectSettings members={members} />);
  return { screen, changes };
}

it("turns a server on and off at the chosen scope, and says when it's off", async () => {
  const { screen, changes } = await setup({ servers: [check({ off: true }), RUFF] });
  await using _screen = screen;
  await expect
    .element(screen.getByText("Off in settings. Turn it on here to use it."))
    .toBeVisible();
  await userEvent.click(screen.getByRole("switch", { name: "basedpyright 1.40.2 on" }));
  await vi.waitFor(() =>
    expect(changes).toEqual([
      { type: "enabled", scope: "project", server: "basedpyright", enabled: true },
    ]),
  );

  await userEvent.click(screen.getByRole("combobox", { name: "Changes here apply to" }));
  await userEvent.click(page.getByRole("option", { name: "All projects" }));
  await userEvent.click(screen.getByRole("switch", { name: "Ruff 0.17.4 on" }));
  await vi.waitFor(() =>
    expect(changes.at(-1)).toEqual({
      type: "enabled",
      scope: "machine",
      server: "ruff",
      enabled: false,
    }),
  );
});

it("orders a language's servers from a picker, with the first marked", async () => {
  const { screen, changes } = await setup();
  await using _screen = screen;
  await expect.element(screen.getByText("Runs first")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Run basedpyright 1.40.2 earlier" }))
    .toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Run Ruff 0.17.4 earlier" }));
  await vi.waitFor(() =>
    expect(changes).toEqual([
      {
        type: "order",
        scope: "project",
        language: "basedpyright",
        order: ["ruff", "basedpyright"],
      },
    ]),
  );
});

it("shows bad JSON at its field and changes nothing, then saves it fixed", async () => {
  const { screen, changes } = await setup({
    settings: {
      machine: EMPTY,
      project: { servers: { basedpyright: { enabled: false } }, order: {} },
      custom: [],
    },
  });
  await using _screen = screen;
  await userEvent.click(screen.getByRole("button", { name: "Configure" }).first());
  const settings = screen.getByRole("textbox", { name: "Settings", exact: true });
  await userEvent.fill(settings, "{ nope");
  await userEvent.click(screen.getByRole("button", { name: "Save basedpyright 1.40.2" }));
  await expect.element(screen.getByRole("alert")).toBeVisible();
  expect(changes).toEqual([]);

  await userEvent.fill(settings, '{"python":{"analysis":{}}}');
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Save basedpyright 1.40.2" }));
  await vi.waitFor(() =>
    expect(changes).toEqual([
      {
        type: "server",
        scope: "project",
        server: "basedpyright",
        // Saving the form keeps the server as it was.
        override: { enabled: false, settings: { python: { analysis: {} } } },
      },
    ]),
  );
});

it("says what's overridden and where from, and why a project's file is ignored", async () => {
  const { screen } = await setup({
    servers: [
      check({
        overrides: [
          { field: "settings", source: "file" },
          { field: "args", source: "project" },
        ],
        replacedBy: ["My Python"],
      }),
    ],
    projectFile: {
      path: ".astrolabe/language-servers.json",
      read: true,
      problem: '.astrolabe/language-servers.json can\'t set "binary".',
    },
  });
  await using _screen = screen;
  await expect
    .element(
      screen.getByText(
        "Settings from .astrolabe/language-servers.json, Arguments from this project",
      ),
    )
    .toBeVisible();
  await expect.element(screen.getByText("My Python takes its place on some files.")).toBeVisible();
  await expect
    .element(screen.getByText(".astrolabe/language-servers.json is ignored"))
    .toBeVisible();
});

it("adds a server of someone's own in the page, and removes it again", async () => {
  const added = {
    id: "custom:mine",
    name: "Mine",
    command: "mine-ls",
    args: [],
    env: {},
    languageIds: { foo: "foolang" },
    rootFiles: [],
    replaces: false,
  } as const;
  const { screen, changes } = await setup({
    servers: [
      check({}),
      check({
        server: added.id,
        name: "Mine",
        languages: ".foo",
        language: null,
        executable: "/bin/mine-ls",
      }),
    ],
    settings: { machine: EMPTY, project: EMPTY, custom: [added] },
  });
  await using _screen = screen;
  await userEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await expect.element(screen.getByText("Give it a name.")).toBeVisible();
  expect(changes).toEqual([]);
  await userEvent.fill(screen.getByRole("textbox", { name: "Name" }), "Other");
  await userEvent.fill(screen.getByRole("textbox", { name: "Command" }), "/opt/other-ls");
  await userEvent.fill(screen.getByRole("textbox", { name: "File extensions" }), ".bar barlang");
  await userEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await vi.waitFor(() =>
    expect(changes).toEqual([
      {
        type: "custom",
        id: null,
        server: {
          name: "Other",
          command: "/opt/other-ls",
          args: [],
          env: {},
          languageIds: { bar: "barlang" },
          rootFiles: [],
          replaces: false,
        },
      },
    ]),
  );

  await userEvent.click(screen.getByRole("button", { name: "Configure" }).last());
  // The form of a server added here is its own: how it runs isn't overridden in this one.
  await expect.element(screen.getByRole("textbox", { name: "Binary" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  await vi.waitFor(() =>
    expect(changes.at(-1)).toEqual({ type: "removeCustom", id: "custom:mine" }),
  );
});
