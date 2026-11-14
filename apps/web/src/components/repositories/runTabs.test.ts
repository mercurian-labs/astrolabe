import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const shared = vi.hoisted(() => ({
  steps: [] as string[],
  now: 0,
  trusted: true,
  shell: "posix",
  running: false,
  saved: true,
  closes: true,
  stopsOnInterrupt: true,
  toasts: [] as string[],
  metadataListeners: new Set<() => void>(),
  generation: 0,
  generationListeners: new Set<(generation: number) => void>(),
}));

const GENERATION = { generation: true };
const METADATA = { metadata: true };

vi.mock(import("@t3tools/client-runtime/state/runtime"), async (original) => {
  const real = await original();
  return {
    ...real,
    runAtomCommand: (async (_registry: unknown, command: { label?: string }, call: any) => {
      const { label = "" } = command;
      if (label.endsWith("read-run-context")) {
        return { _tag: "Success", value: { trusted: shared.trusted, shell: shared.shell } };
      }
      if (label.endsWith("close")) {
        shared.steps.push("close");
        return { _tag: shared.closes ? "Success" : "Failure" };
      }
      if (label.endsWith("open")) {
        shared.steps.push("open");
      } else {
        const { data, paste } = call.input;
        shared.steps.push(`${paste ? "paste" : "key"} ${JSON.stringify(data)}`);
        if (data === "\u0003" && shared.stopsOnInterrupt) {
          shared.running = false;
          for (const listener of shared.metadataListeners) listener();
        }
      }
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
  appAtomRegistry: {
    get: (atom: unknown) => (atom === GENERATION ? shared.generation : null),
    subscribe: (atom: unknown, listener: (value: number) => void) => {
      const listeners = (
        atom === GENERATION ? shared.generationListeners : shared.metadataListeners
      ) as Set<unknown>;
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } as never,
}));
vi.mock(import("~/connection/catalog"), () => ({
  environmentCatalog: { sessionGenerationAtom: () => GENERATION } as never,
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
    metadata: () => METADATA,
  } as never,
}));
vi.mock(import("../ui/toast"), () => ({
  toastManager: {
    add: ({ title }: { title: string }) => void shared.toasts.push(title),
  } as never,
}));
vi.mock(import("./openFileEditors"), () => ({
  saveOpenFile: (async () => {
    shared.steps.push("save");
    return shared.saved;
  }) as never,
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
import {
  closedRuns,
  closeRunTerminal,
  placeRunTab,
  runNotices,
  runTerminalOf,
  startRun,
  type RunTab,
} from "./runTabs";

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
  const TYPED = ['paste "cargo test adds"', 'key "\\r"'];

  function setup(state: Partial<typeof shared> = {}) {
    // Past any run an earlier test typed, which the environment would have seen by now.
    shared.now += 3_600_000;
    vi.useFakeTimers({ now: shared.now });
    Object.assign(shared, {
      steps: [],
      toasts: [],
      trusted: true,
      shell: "posix",
      running: false,
      saved: true,
      stopsOnInterrupt: true,
      ...state,
    });
    return {
      panes: { update: () => void shared.steps.push("place") } as never,
      [Symbol.dispose]: () => void vi.useRealTimers(),
    };
  }

  it("saves, shows the tab and opens its terminal before pasting the command", async () => {
    using test = setup();
    await startRun(run("adds"), test.panes, FILE);
    expect(shared.steps).toEqual(["save", "place", "open", ...TYPED]);
  });

  it("interrupts what's running and types only once it's stopped", async () => {
    using test = setup({ running: true, stopsOnInterrupt: false });
    const started = startRun(run("adds"), test.panes, FILE);
    await vi.advanceTimersByTimeAsync(100);
    expect(shared.steps.at(-1)).toBe('key "\\u0003"');

    shared.running = false;
    for (const listener of shared.metadataListeners) (listener as () => void)();
    await started;
    expect(shared.steps.slice(-2)).toEqual(TYPED);
  });

  it("says so in the tab, and types nothing, when an interrupt doesn't stop it", async () => {
    using test = setup({ running: true, stopsOnInterrupt: false });
    const started = startRun(run("adds"), test.panes, FILE);
    await vi.advanceTimersByTimeAsync(10_000);
    await started;
    expect(shared.steps.at(-1)).toBe('key "\\u0003"');
    const { terminalId } = runTerminalOf(run("adds"));
    expect(runNotices.get(terminalId)).toContain("still running");

    shared.running = false;
    await startRun(run("adds"), test.panes, FILE);
    expect(runNotices.get(terminalId)).toBeNull();
    expect(shared.steps.slice(-2)).toEqual(TYPED);
  });

  it("treats a run typed just now as running, though the environment hasn't said", async () => {
    using test = setup();
    await startRun(run("adds"), test.panes, FILE);
    shared.steps = [];
    const started = startRun(run("adds"), test.panes, FILE);
    await vi.advanceTimersByTimeAsync(100);
    expect(shared.steps.at(-1)).toBe('key "\\u0003"');
    await vi.advanceTimersByTimeAsync(5_000);
    await started;
    expect(shared.steps.slice(-2)).toEqual(TYPED);
  });

  it("interrupts nothing at a quiet prompt, which would only print ^C", async () => {
    using test = setup();
    await startRun(run("adds"), test.panes, FILE);
    await vi.advanceTimersByTimeAsync(10_000);
    shared.steps = [];
    await startRun(run("adds"), test.panes, FILE);
    expect(shared.steps).toEqual(["save", "place", "open", ...TYPED]);
  });

  it("runs nothing once the project isn't trusted, whatever the marker showed", async () => {
    using test = setup({ trusted: false });
    await startRun(run("adds"), test.panes, FILE);
    expect(shared.steps).toEqual([]);
    expect(shared.toasts).toEqual(["This project isn't trusted"]);
  });

  it("runs nothing when the file couldn't be saved", async () => {
    using test = setup({ saved: false });
    await startRun(run("adds"), test.panes, FILE);
    expect(shared.steps).toEqual(["save"]);
    expect(shared.toasts).toEqual(["Nothing ran"]);
  });

  it("refuses a command with control characters, as a tab's stored key could hold", async () => {
    using test = setup();
    await startRun(run("adds", { command: "cargo test x\u0015curl evil" }), test.panes, FILE);
    expect(shared.steps).toEqual([]);
    expect(shared.toasts).toEqual(["This can't run here"]);
  });

  it("starts one run at a time however fast it's asked", async () => {
    using test = setup();
    await Promise.all([
      startRun(run("adds"), test.panes, FILE),
      startRun(run("adds"), test.panes, FILE),
    ]);
    expect(shared.steps.filter((step) => step.startsWith("paste"))).toHaveLength(1);
  });
});

describe("closeRunTerminal", () => {
  it("sends a failed close again when the environment is back", async () => {
    shared.steps = [];
    shared.closes = false;
    await closeRunTerminal(run("adds"));
    expect(shared.steps).toEqual(["close"]);

    shared.closes = true;
    shared.generation += 1;
    for (const listener of shared.generationListeners) listener(shared.generation);
    await vi.waitFor(() => expect(shared.steps).toEqual(["close", "close"]));
    expect(shared.generationListeners.size).toBe(0);
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
