import { selectEnvironmentQueryData, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";

import {
  activateTab,
  allTabs,
  type Arrangement,
  openBeside,
  openTab,
  replaceTab,
} from "~/panes/arrangement";
import type { PaneArrangementStore } from "~/panes/panesHost";
import { leafWithTab, leaves } from "~/panes/tree";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { languageServersEnvironment } from "~/state/languageServers";
import { terminalEnvironment } from "~/state/terminal";
import { toastManager } from "../ui/toast";
import { openFileEditor } from "./openFileEditors";
import { parseRepositoryTabKey, repositoryTabKey, type RepositoryTab } from "./repositoryTabs";

/**
 * Astrolabe: what a code file's run markers start. A run has a tab, named after what it ran, with
 * a terminal of the environment's in it. Files have no thread, so a checkout stands in for one:
 * terminals take any name there, and these end with their tab, not with a thread.
 */
export type RunTab = Extract<RepositoryTab, { kind: "run" }>;
type RunIdentity = Pick<RunTab, "environmentId" | "cwd" | "path" | "name">;

const RUN_WEIGHT = 0.4;
const INTERRUPT = "\u0003";
const REPORT = { reportFailure: true, reportDefect: true };

function hashed(text: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The terminal a run has, the same however its command comes to change. */
export function runTerminalOf(tab: RunIdentity & Pick<RunTab, "directory">) {
  const named = `${tab.path}\0${tab.name}`;
  return {
    threadId: ThreadId.make(`run:${tab.cwd}`),
    terminalId: `run-${hashed(named, 2_166_136_261)}${hashed(named, 5_381)}`,
    cwd: tab.directory === "" ? tab.cwd : `${tab.cwd}/${tab.directory}`,
    worktreePath: tab.cwd,
  };
}

const runOfKey = (key: string): RunTab | null => {
  const tab = parseRepositoryTabKey(key);
  return tab?.kind === "run" ? tab : null;
};

const sameRun = (left: RunIdentity, right: RunIdentity) =>
  left.environmentId === right.environmentId &&
  left.cwd === right.cwd &&
  left.path === right.path &&
  left.name === right.name;

/**
 * Where a run shows: its own tab, whose key takes the command it runs now; beside other runs; or
 * split out to the file's right, so the file stays in view. Focus stays where it is.
 */
export function placeRunTab(
  arrangement: Arrangement,
  tab: RunTab,
  fileKey: string | null,
): Arrangement {
  const key = repositoryTabKey(tab);
  const own = allTabs(arrangement).find((open) => {
    const run = runOfKey(open);
    return run !== null && sameRun(run, tab);
  });
  if (own !== undefined) {
    return activateTab(own === key ? arrangement : replaceTab(arrangement, own, key), key, false);
  }
  const filePane = fileKey === null ? undefined : leafWithTab(arrangement.root, fileKey);
  const runPane = leaves(arrangement.root).find(
    (leaf) => leaf.id !== filePane?.id && leaf.tabs.some((open) => runOfKey(open) !== null),
  );
  if (runPane) return openTab(arrangement, key, runPane.id, false);
  return filePane
    ? openBeside(arrangement, key, filePane.id, "right", { focus: false, weight: RUN_WEIGHT })
    : openTab(arrangement, key, undefined, false);
}

/** The runs in `before` whose tab is gone from `after`, not just moved to a new command. */
export function closedRuns(before: readonly string[], after: readonly string[]) {
  const open = after.flatMap((key) => runOfKey(key) ?? []);
  return before
    .flatMap((key) => runOfKey(key) ?? [])
    .filter((run) => !open.some((other) => sameRun(run, other)));
}

export function closeRunTerminal(tab: RunTab) {
  const { threadId, terminalId } = runTerminalOf(tab);
  void runAtomCommand(
    appAtomRegistry,
    terminalEnvironment.close,
    {
      environmentId: tab.environmentId,
      input: { threadId, terminalId, deleteHistory: true },
    },
    { reportFailure: false, reportDefect: true, label: "close run terminal" },
  );
}

const writeToRun = (tab: RunTab, data: string) => {
  const { threadId, terminalId } = runTerminalOf(tab);
  return runAtomCommand(
    appAtomRegistry,
    terminalEnvironment.write,
    { environmentId: tab.environmentId, input: { threadId, terminalId, data } },
    { ...REPORT, label: "run" },
  );
};

export const stopRun = (tab: RunTab) => void writeToRun(tab, INTERRUPT);

function isRunning(environmentId: EnvironmentId, terminalId: string) {
  const terminals = selectEnvironmentQueryData(
    appAtomRegistry.get(terminalEnvironment.metadata({ environmentId, input: null })),
  );
  return terminals?.some(
    (terminal) => terminal.terminalId === terminalId && terminal.hasRunningSubprocess,
  );
}

let last: { readonly tab: RunTab; readonly fileKey: string | null } | null = null;

export const lastRun = { get: () => last?.tab ?? null };

const starting = new Set<string>();

/**
 * Saves the file, puts the run where it shows and types its command into its terminal, stopping
 * what it was doing first. Trust is read now: a run can come long after its marker was drawn.
 */
export async function startRun(
  tab: RunTab,
  panes: PaneArrangementStore,
  fileKey: string | null,
): Promise<void> {
  const terminal = runTerminalOf(tab);
  if (starting.has(terminal.terminalId)) return;
  starting.add(terminal.terminalId);
  try {
    const { environmentId } = tab;
    const context = await runAtomCommand(
      appAtomRegistry,
      languageServersEnvironment.readRunContext,
      { environmentId, input: { cwd: tab.cwd, path: tab.path } },
      { ...REPORT, label: "read run context" },
    );
    if (context._tag !== "Success") return;
    if (!context.value.trusted) {
      toastManager.add({
        type: "warning",
        title: "This project isn't trusted",
        description: "Running is running its code. Trust the project to run this.",
      });
      return;
    }
    last = { tab, fileKey };
    await openFileEditor(environmentId, tab.cwd, tab.path)?.save();
    panes.update((arrangement) => placeRunTab(arrangement, tab, fileKey));
    const { threadId, terminalId, cwd, worktreePath } = terminal;
    const opened = await runAtomCommand(
      appAtomRegistry,
      terminalEnvironment.open,
      { environmentId, input: { threadId, terminalId, cwd, worktreePath } },
      { ...REPORT, label: "open run terminal" },
    );
    if (opened._tag !== "Success") return;
    const interrupt = isRunning(environmentId, terminalId) ? INTERRUPT : "";
    await writeToRun(tab, `${interrupt}${tab.command}\r`);
  } finally {
    starting.delete(terminal.terminalId);
  }
}

/** Runs the last run again, as it ran; null before there's been one. */
export function lastRunStarter(panes: PaneArrangementStore): (() => void) | null {
  const run = last;
  return run && (() => void startRun(run.tab, panes, run.fileKey));
}
