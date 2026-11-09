import { selectEnvironmentQueryData, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { isRunnableText } from "@mercurian/editor/run/command";
import { runTerminalThreadId, ThreadId, type EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "~/connection/catalog";
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
import { saveOpenFile } from "./openFileEditors";
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
// The environment notices a process within about a second of it starting.
const UNSEEN_MS = 2_000;
const STOP_BOUND_MS = 5_000;
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
    threadId: ThreadId.make(runTerminalThreadId(tab.cwd)),
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

// Closes a connection dropped, kept to send again when the environment is back.
const unclosed = new Map<EnvironmentId, Map<string, RunTab>>();
const watching = new Map<EnvironmentId, () => void>();

function retryWhenConnected(environmentId: EnvironmentId) {
  if (watching.has(environmentId)) return;
  const generation = environmentCatalog.sessionGenerationAtom(environmentId);
  const seen = appAtomRegistry.get(generation);
  const stop = appAtomRegistry.subscribe(generation, (next) => {
    if (next === seen) return;
    watching.delete(environmentId);
    stop();
    const tabs = [...(unclosed.get(environmentId)?.values() ?? [])];
    unclosed.delete(environmentId);
    tabs.forEach(closeRunTerminal);
  });
  watching.set(environmentId, stop);
}

export async function closeRunTerminal(tab: RunTab) {
  const { environmentId } = tab;
  const { threadId, terminalId } = runTerminalOf(tab);
  const closed = await runAtomCommand(
    appAtomRegistry,
    terminalEnvironment.close,
    { environmentId, input: { threadId, terminalId, deleteHistory: true } },
    { reportFailure: false, reportDefect: true, label: "close run terminal" },
  );
  if (closed._tag === "Success") return;
  const tabs = unclosed.get(environmentId) ?? new Map<string, RunTab>();
  unclosed.set(environmentId, tabs.set(terminalId, tab));
  retryWhenConnected(environmentId);
}

const writeToRun = (tab: RunTab, data: string, paste?: true) => {
  const { threadId, terminalId } = runTerminalOf(tab);
  return runAtomCommand(
    appAtomRegistry,
    terminalEnvironment.write,
    {
      environmentId: tab.environmentId,
      input: { threadId, terminalId, data, ...(paste ? { paste } : {}) },
    },
    { ...REPORT, label: "run" },
  );
};

export const stopRun = (tab: RunTab) => void writeToRun(tab, INTERRUPT);

const metadataAtom = (environmentId: EnvironmentId) =>
  terminalEnvironment.metadata({ environmentId, input: null });

function isRunning(environmentId: EnvironmentId, terminalId: string) {
  const terminals = selectEnvironmentQueryData(appAtomRegistry.get(metadataAtom(environmentId)));
  return (
    terminals?.some(
      (terminal) => terminal.terminalId === terminalId && terminal.hasRunningSubprocess,
    ) === true
  );
}

/** Waits for the terminal to say it's idle, not before `after` ms; false if it never does. */
const idleWithin = (environmentId: EnvironmentId, terminalId: string, after: number) =>
  new Promise<boolean>((resolve) => {
    const earliest = Date.now() + after;
    const finish = (idle: boolean) => {
      clearTimeout(bound);
      clearTimeout(settled);
      stop();
      resolve(idle);
    };
    const check = () => {
      if (Date.now() >= earliest && !isRunning(environmentId, terminalId)) finish(true);
    };
    const bound = setTimeout(() => finish(false), STOP_BOUND_MS);
    const settled = setTimeout(check, after);
    const stop = appAtomRegistry.subscribe(metadataAtom(environmentId), check);
    check();
  });

const typedAt = new Map<string, number>();

/** Interrupts what's running; a run typed just now may be too new for the environment to know. */
async function stopWhatsRunning(tab: RunTab, terminalId: string) {
  const unseenFor = (typedAt.get(terminalId) ?? 0) + UNSEEN_MS - Date.now();
  const running = isRunning(tab.environmentId, terminalId);
  if (!running && unseenFor <= 0) return true;
  await writeToRun(tab, INTERRUPT);
  return idleWithin(tab.environmentId, terminalId, running ? 0 : unseenFor);
}

const notices = new Map<string, string>();
const noticeListeners = new Set<() => void>();

function setNotice(terminalId: string, notice: string | null) {
  if (notice === null) notices.delete(terminalId);
  else notices.set(terminalId, notice);
  for (const listener of noticeListeners) listener();
}

/** What a run's tab should say about why it didn't start. */
export const runNotices = {
  get: (terminalId: string) => notices.get(terminalId) ?? null,
  subscribe(listener: () => void) {
    noticeListeners.add(listener);
    return () => void noticeListeners.delete(listener);
  },
};

let last: { readonly tab: RunTab; readonly fileKey: string | null } | null = null;

const starting = new Set<string>();

/**
 * Saves the file, puts the run where it shows, stops what its terminal was doing and types its
 * command. Trust and what can be typed are read now: a run can come long after its marker, and a
 * tab's key can come from storage.
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
    if (!isRunnableText(tab.command, context.value.shell)) {
      toastManager.add({
        type: "warning",
        title: "This can't run here",
        description: "Its command has text a terminal would act on.",
      });
      return;
    }
    last = { tab, fileKey };
    if (!(await saveOpenFile(environmentId, tab.cwd, tab.path))) {
      toastManager.add({
        type: "error",
        title: "Nothing ran",
        description: `${tab.path} couldn't be saved, so a run would use its old text.`,
      });
      return;
    }
    setNotice(terminal.terminalId, null);
    panes.update((arrangement) => placeRunTab(arrangement, tab, fileKey));
    const { threadId, terminalId, cwd, worktreePath } = terminal;
    const opened = await runAtomCommand(
      appAtomRegistry,
      terminalEnvironment.open,
      { environmentId, input: { threadId, terminalId, cwd, worktreePath } },
      { ...REPORT, label: "open run terminal" },
    );
    if (opened._tag !== "Success") return;
    if (!(await stopWhatsRunning(tab, terminalId))) {
      setNotice(terminalId, "It's still running after an interrupt, so this run didn't start.");
      return;
    }
    await writeToRun(tab, tab.command, true);
    await writeToRun(tab, "\r");
    typedAt.set(terminalId, Date.now());
  } finally {
    starting.delete(terminal.terminalId);
  }
}

/** Runs the last run again, as it ran; null before there's been one. */
export function lastRunStarter(panes: PaneArrangementStore): (() => void) | null {
  const run = last;
  return run && (() => void startRun(run.tab, panes, run.fileKey));
}
