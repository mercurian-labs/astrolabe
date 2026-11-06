import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const shared = vi.hoisted(() => ({
  steps: [] as string[],
  trusted: true,
  running: false,
  toasts: [] as string[],
}));

vi.mock(import("@t3tools/client-runtime/state/runtime"), async (original) => {
  const real = await original();
  return {
    ...real,
    runAtomCommand: (async (_registry: unknown, command: { label?: string }, call: any) => {
      const { label = "" } = command;
      if (label.endsWith("read-run-context")) {
        return { _tag: "Success", value: { trusted: shared.trusted } };
      }
      shared.steps.push(label.endsWith("open") ? "open" : `write ${call.input.data}`);
      return { _tag: "Success", value: null };
    }) as never,
    selectEnvironmentQueryData: (() =>
      shared.running
        ? [{ terminalId: runTerminalOf(run("adds")).terminalId, hasRunningSubprocess: true }]
        : []) as never,
  };
});
vi.mock(import("~/rpc/atomRegistry"), async (original) => ({
  ...(await original()),
  appAtomRegistry: { get: () => null } as never,
}));
vi.mock(import("~/state/languageServers"), () => ({
  languageServersEnvironment: {
    readRunContext: { label: "language-servers:read-run-context" },
  } as never,
}));
vi.mock(import("~/state/terminal"), () => ({
  terminalEnvironment: {
    open: { label: "terminal:open" },
    write: { label: "terminal:write" },
    close: { label: "terminal:close" },
    metadata: () => null,
  } as never,
}));
vi.mock(import("../ui/toast"), () => ({
  toastManager: {
    add: ({ title }: { title: string }) => void shared.toasts.push(title),
  } as never,
}));
vi.mock(import("./openFileEditors"), () => ({
  openFileEditor: (() => ({
    save: async () => void shared.steps.push("save"),
  })) as never,
}));

import {
  activateTab,
  allTabs,
  openBeside,
  openTab,
  startingArrangement,
} from "~/panes/arrangement";
import { leafWithTab, leaves } from "~/panes/tree";
import { repositoryTabKey } from "./repositoryTabs";
import { closedRuns, placeRunTab, runTerminalOf, startRun, type RunTab } from "./runTabs";

const environmentId = EnvironmentId.make("env");

const run = (name: string, overrides: Partial<RunTab> = {}): RunTab => ({
  kind: "run",
  environmentId,
  cwd: "/repo",
  directory: "",
  path: "src/a.rs",
  name,
  command: `cargo test ${name}`,
  ...overrides,
});

const FILE = "file-tab";

describe("placeRunTab", () => {
  const opened = () => placeRunTab(openTab(startingArrangement(), FILE), run("adds"), FILE);

  it("splits out beside the file the first time, leaving focus and the file where they are", () => {
    const before = openTab(startingArrangement(), FILE);
    const arrangement = placeRunTab(before, run("adds"), FILE);
    const key = repositoryTabKey(run("adds"));
    expect(leaves(arrangement.root)).toHaveLength(2);
    expect(leafWithTab(arrangement.root, FILE)?.active).toBe(FILE);
    expect(leafWithTab(arrangement.root, key)?.id).not.toBe(
      leafWithTab(arrangement.root, FILE)?.id,
    );
    expect(arrangement.focused).toBe(before.focused);
  });

  it("keeps later runs together beside the file", () => {
    const arrangement = placeRunTab(opened(), run("rounds"), FILE);
    expect(leaves(arrangement.root)).toHaveLength(2);
    const pane = leafWithTab(arrangement.root, repositoryTabKey(run("rounds")));
    expect(pane?.tabs).toContain(repositoryTabKey(run("adds")));
    expect(pane?.active).toBe(repositoryTabKey(run("rounds")));
  });

  it("brings a run's own tab back to the front instead of opening another", () => {
    const again = placeRunTab(placeRunTab(opened(), run("rounds"), FILE), run("adds"), FILE);
    expect(allTabs(again).filter((key) => key !== FILE)).toHaveLength(2);
    expect(leafWithTab(again.root, repositoryTabKey(run("adds")))?.active).toBe(
      repositoryTabKey(run("adds")),
    );
  });

  it("gives a run's own tab the command it runs now", () => {
    const changed = run("adds", { command: "cargo test --package core adds" });
    const arrangement = placeRunTab(opened(), changed, FILE);
    expect(allTabs(arrangement).toSorted()).toEqual([FILE, repositoryTabKey(changed)].toSorted());
  });

  it("opens in the pane in focus when no file asked", () => {
    const arrangement = placeRunTab(openTab(startingArrangement(), FILE), run("adds"), null);
    expect(leaves(arrangement.root)).toHaveLength(1);
  });

  it("doesn't take a run in the file's own pane for a pane of runs", () => {
    const start = openTab(startingArrangement(), FILE);
    const shared = openTab(start, repositoryTabKey(run("adds")));
    const front = activateTab(shared, FILE);
    const arrangement = placeRunTab(front, run("rounds"), FILE);
    expect(leaves(arrangement.root)).toHaveLength(2);
    expect(leafWithTab(arrangement.root, FILE)?.active).toBe(FILE);
  });

  it("uses a pane of runs wherever it is", () => {
    const start = openTab(startingArrangement(), FILE);
    const split = openBeside(start, repositoryTabKey(run("adds")), start.focused, "left");
    const arrangement = placeRunTab(split, run("rounds"), FILE);
    expect(leaves(arrangement.root)).toHaveLength(2);
    expect(leafWithTab(arrangement.root, repositoryTabKey(run("rounds")))?.tabs).toContain(
      repositoryTabKey(run("adds")),
    );
  });
});

describe("startRun", () => {
  function setup(state: { readonly trusted?: boolean; readonly running?: boolean } = {}) {
    shared.steps = [];
    shared.toasts = [];
    shared.trusted = state.trusted ?? true;
    shared.running = state.running ?? false;
    return { update: () => void shared.steps.push("place") } as never;
  }

  it("saves, shows the tab and opens its terminal before typing the command", async () => {
    await startRun(run("adds"), setup(), FILE);
    expect(shared.steps).toEqual(["save", "place", "open", "write cargo test adds\r"]);
  });

  it("stops what's running before running again", async () => {
    await startRun(run("adds"), setup({ running: true }), FILE);
    expect(shared.steps.at(-1)).toBe("write \u0003cargo test adds\r");
  });

  it("runs nothing once the project isn't trusted, whatever the marker showed", async () => {
    await startRun(run("adds"), setup({ trusted: false }), FILE);
    expect(shared.steps).toEqual([]);
    expect(shared.toasts).toEqual(["This project isn't trusted"]);
  });

  it("starts one run at a time however fast it's asked", async () => {
    const panes = setup();
    await Promise.all([startRun(run("adds"), panes, FILE), startRun(run("adds"), panes, FILE)]);
    expect(shared.steps.filter((step) => step.startsWith("write"))).toHaveLength(1);
  });
});

describe("runTerminalOf", () => {
  it("keeps one terminal for a test whatever its command", () => {
    expect(runTerminalOf(run("adds")).terminalId).toBe(
      runTerminalOf(run("adds", { command: "other" })).terminalId,
    );
  });

  it("keeps runs apart by file and name, each terminal within its id limit", () => {
    const ids = [
      runTerminalOf(run("adds")),
      runTerminalOf(run("rounds")),
      runTerminalOf(run("adds", { path: "src/b.rs" })),
    ].map(({ terminalId }) => terminalId);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(128);
  });

  it("runs in the manifest's folder, under its checkout", () => {
    expect(runTerminalOf(run("adds", { directory: "crates/core" }))).toMatchObject({
      cwd: "/repo/crates/core",
      worktreePath: "/repo",
    });
    expect(runTerminalOf(run("adds")).cwd).toBe("/repo");
  });
});

describe("closedRuns", () => {
  const adds = repositoryTabKey(run("adds"));
  const rounds = repositoryTabKey(run("rounds"));

  it("names runs whose tab went, ignoring other tabs", () => {
    expect(closedRuns([FILE, adds, rounds], [FILE, rounds])).toEqual([run("adds")]);
    expect(closedRuns([FILE, adds], [adds])).toEqual([]);
  });

  it("doesn't take a tab that changed command for one that closed", () => {
    const moved = repositoryTabKey(run("adds", { command: "cargo test --lib adds" }));
    expect(closedRuns([adds], [moved])).toEqual([]);
  });
});
