import type {
  GitClientCommit,
  GitClientFile,
  GitClientStatus,
  GitClientTurn,
} from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";

/**
 * Astrolabe: what the Git tab shows and what its keys do, apart from React. Changes are grouped
 * by the turn that made them; the person's own changes come last, conflicts first.
 */

export type ChangeGroup =
  | { readonly kind: "conflicts"; readonly key: string; readonly files: readonly GitClientFile[] }
  | {
      readonly kind: "turn";
      readonly key: string;
      readonly turn: GitClientTurn;
      readonly files: readonly GitClientFile[];
    }
  | { readonly kind: "own"; readonly key: string; readonly files: readonly GitClientFile[] };

export type ChangeRow =
  | { readonly kind: "group"; readonly key: string; readonly group: ChangeGroup }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly file: GitClientFile;
      readonly group: ChangeGroup;
    };

const fileKey = (path: string) => `file:${path}`;

const byPath = (a: GitClientFile, b: GitClientFile) => a.path.localeCompare(b.path);

/** Conflicts first, then each turn's files, newest turn first, then the person's own. */
export function groupChanges(
  status: Pick<GitClientStatus, "files" | "turns">,
): readonly ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  const conflicts = status.files.filter((file) => file.conflicted).toSorted(byPath);
  if (conflicts.length > 0)
    groups.push({ kind: "conflicts", key: "group:conflicts", files: conflicts });
  const rest = status.files.filter((file) => !file.conflicted);
  for (const turn of status.turns) {
    const files = rest.filter((file) => file.turnRunId === turn.runId).toSorted(byPath);
    if (files.length > 0) groups.push({ kind: "turn", key: `group:${turn.runId}`, turn, files });
  }
  const named = new Set(status.turns.map((turn) => turn.runId));
  const own = rest
    .filter((file) => file.turnRunId === null || !named.has(file.turnRunId))
    .toSorted(byPath);
  if (own.length > 0) groups.push({ kind: "own", key: "group:own", files: own });
  return groups;
}

export function changeRows(groups: readonly ChangeGroup[]): readonly ChangeRow[] {
  return groups.flatMap((group): ChangeRow[] => [
    { kind: "group", key: group.key, group },
    ...group.files.map((file): ChangeRow => ({
      kind: "file",
      key: fileKey(file.path),
      file,
      group,
    })),
  ]);
}

export type StageState = "staged" | "partly" | "unstaged" | "conflicted";

export function stageState(file: GitClientFile): StageState {
  if (file.conflicted) return "conflicted";
  if (file.untracked || file.index === null) return "unstaged";
  return file.workingTree === null ? "staged" : "partly";
}

/** What Space does to some files: unstage them when all are staged, else stage them all. */
export function stageToggle(files: readonly GitClientFile[]): {
  readonly action: "stage" | "unstage";
  readonly paths: readonly string[];
} | null {
  if (files.length === 0) return null;
  if (files.every((file) => stageState(file) === "staged")) {
    return {
      action: "unstage",
      // A staged rename's source goes back with it, or its deletion would stay staged.
      paths: files.flatMap((file) =>
        file.originalPath === null ? [file.path] : [file.path, file.originalPath],
      ),
    };
  }
  return { action: "stage", paths: files.map((file) => file.path) };
}

/** The files a selected row stands for: a file, or every file of its group. */
export function rowFiles(row: ChangeRow | undefined): readonly GitClientFile[] {
  if (row === undefined) return [];
  return row.kind === "file" ? [row.file] : row.group.files;
}

/**
 * A selection kept across refreshes: the same row when it is still there, else the row now in
 * its place, else the last row.
 */
export function keepSelection(
  keys: readonly string[],
  selected: string | null,
  previousIndex: number,
): string | null {
  if (keys.length === 0) return null;
  if (selected !== null && keys.includes(selected)) return selected;
  return keys[Math.min(Math.max(previousIndex, 0), keys.length - 1)] ?? null;
}

export function moveSelection(
  keys: readonly string[],
  selected: string | null,
  delta: number,
): string | null {
  if (keys.length === 0) return null;
  const index = selected === null ? -1 : keys.indexOf(selected);
  if (index === -1) return keys[delta < 0 ? keys.length - 1 : 0] ?? null;
  return keys[Math.min(Math.max(index + delta, 0), keys.length - 1)] ?? null;
}

export type CommitScope =
  | { readonly mode: "staged"; readonly count: number }
  | { readonly mode: "all"; readonly count: number }
  | { readonly mode: "none" };

/** What Commit takes: what is staged, or with nothing staged, every change. */
export function commitScope(files: readonly GitClientFile[]): CommitScope {
  const staged = files.filter((file) => !file.conflicted && file.index !== null).length;
  if (staged > 0) return { mode: "staged", count: staged };
  return files.length === 0 ? { mode: "none" } : { mode: "all", count: files.length };
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export function commitScopeLabel(scope: CommitScope): string {
  switch (scope.mode) {
    case "staged":
      return plural(scope.count, "staged file");
    case "all":
      return scope.count === 1 ? "the 1 changed file" : `all ${scope.count} changed files`;
    case "none":
      return "Nothing to commit";
  }
}

export type GitList = "changes" | "commits";

export type GitKeyAction =
  | { readonly type: "move"; readonly delta: number }
  | { readonly type: "list"; readonly list: GitList | "other" }
  | { readonly type: "toggleStage" }
  | { readonly type: "toggleAll" }
  | { readonly type: "focusCommit" }
  | { readonly type: "discard" }
  | { readonly type: "undo" }
  | { readonly type: "fetch" }
  | { readonly type: "pull" }
  | { readonly type: "push" }
  | { readonly type: "open" }
  | { readonly type: "openTurn" }
  | { readonly type: "handToAgent" }
  | { readonly type: "help" };

/** What a key does in a list. Keys a list can't use there do nothing, so they reach the app. */
export function gitKeyAction(
  key: string,
  modifiers: { readonly ctrl: boolean; readonly meta: boolean; readonly alt: boolean },
  list: GitList,
): GitKeyAction | null {
  if (modifiers.ctrl || modifiers.meta || modifiers.alt) return null;
  switch (key) {
    case "j":
    case "ArrowDown":
      return { type: "move", delta: 1 };
    case "k":
    case "ArrowUp":
      return { type: "move", delta: -1 };
    case "Tab":
      return { type: "list", list: "other" };
    case "h":
      return { type: "list", list: "changes" };
    case "l":
      return { type: "list", list: "commits" };
    case "t":
      return { type: "openTurn" };
    case "s":
      return { type: "handToAgent" };
    case "?":
      return { type: "help" };
    case "f":
      return { type: "fetch" };
    case "p":
      return { type: "pull" };
    case "P":
      return { type: "push" };
    case "c":
      return { type: "focusCommit" };
  }
  if (list !== "changes") return null;
  switch (key) {
    case "Enter":
    case "o":
      return { type: "open" };
    case " ":
      return { type: "toggleStage" };
    case "a":
      return { type: "toggleAll" };
    case "d":
      return { type: "discard" };
    case "z":
      return { type: "undo" };
  }
  return null;
}

export interface KeyHint {
  readonly keys: string;
  readonly label: string;
}

/** The hint bar's keys for the focused list, the ones worth learning first; `?` lists them all. */
export function keyHints(list: GitList): readonly KeyHint[] {
  return list === "changes"
    ? [
        { keys: "j/k", label: "move" },
        { keys: "space", label: "stage" },
        { keys: "c", label: "commit" },
        { keys: "s", label: "ask agent" },
        { keys: "t", label: "turn" },
        { keys: "d", label: "discard" },
        { keys: "z", label: "undo" },
        { keys: "a", label: "stage all" },
        { keys: "tab", label: "commits" },
      ]
    : [
        { keys: "j/k", label: "move" },
        { keys: "s", label: "ask agent" },
        { keys: "t", label: "turn" },
        { keys: "p/P", label: "pull/push" },
        { keys: "f", label: "fetch" },
        { keys: "tab", label: "changes" },
      ];
}

/** Every key, for the `?` list. */
export const ALL_KEYS: readonly KeyHint[] = [
  { keys: "j / k, ↓ / ↑", label: "Move down or up the list" },
  { keys: "Tab, h / l", label: "Switch between Changes and Commits" },
  { keys: "Space", label: "Stage or unstage the file, or the whole group on its header" },
  { keys: "a", label: "Stage or unstage everything" },
  { keys: "c", label: "Write the commit message" },
  { keys: "d", label: "Discard the selection, after you confirm" },
  { keys: "z", label: "Undo the last stage, unstage, discard or commit" },
  { keys: "f", label: "Fetch" },
  { keys: "p", label: "Pull" },
  { keys: "P", label: "Push" },
  { keys: "Enter, o", label: "Open the file beside the tab" },
  { keys: "t", label: "Open the turn in its chat" },
  { keys: "s", label: "Hand the selection to the agent" },
  { keys: "?", label: "Show these keys" },
];

export const shortSha = (sha: string) => sha.slice(0, 7);

/** What the selection can be handed to the agent as. */
export type AgentSubject =
  | { readonly kind: "files"; readonly paths: readonly string[]; readonly conflicted: boolean }
  | { readonly kind: "commit"; readonly commit: Pick<GitClientCommit, "sha" | "subject"> };

export interface AgentAsk {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

const mentions = (paths: readonly string[]) =>
  paths.map((path) => serializeComposerFileLink(path)).join(" ");

/** The asks a selection offers, and when the branch is behind, rebasing it. */
export function agentAsks(
  subject: AgentSubject | null,
  behindOf: string | null,
): readonly AgentAsk[] {
  const asks: AgentAsk[] = [];
  if (subject?.kind === "files" && subject.paths.length > 0) {
    const files = mentions(subject.paths);
    if (subject.conflicted) {
      asks.push({
        id: "resolve",
        label: "Resolve these conflicts",
        prompt: `Resolve the merge conflicts in ${files}, keeping what each side meant.`,
      });
    }
    asks.push(
      {
        id: "commit",
        label: "Commit these with a good message",
        prompt: `Commit ${files} with a good message.`,
      },
      { id: "explain", label: "Explain these changes", prompt: `Explain these changes: ${files}` },
      { id: "finish", label: "Finish this", prompt: `Finish the work in ${files}.` },
    );
  }
  if (subject?.kind === "commit") {
    const named = `${shortSha(subject.commit.sha)} “${subject.commit.subject}”`;
    asks.push(
      { id: "explain-commit", label: "Explain this commit", prompt: `Explain commit ${named}.` },
      {
        id: "split-commit",
        label: "Split this commit",
        prompt: `Split commit ${named} into smaller commits that each make sense on their own.`,
      },
      {
        id: "reword-commit",
        label: "Reword it",
        prompt: `Reword the message of commit ${named} so it says what changed and why.`,
      },
    );
  }
  if (behindOf !== null) {
    asks.push({
      id: "rebase",
      label: `Rebase onto ${behindOf} and fix what breaks`,
      prompt: `Rebase this branch onto ${behindOf} and fix what breaks.`,
    });
  }
  return asks;
}

/** A draft with an ask added: after what it already says, never in its place. */
export function appendAsk(draft: string, ask: string): string {
  const before = draft.trimEnd();
  return before.length === 0 ? ask : `${before}\n\n${ask}`;
}

/** "src/" and "app.ts" of "src/app.ts". */
export function splitPath(path: string): { readonly folder: string; readonly name: string } {
  const cut = path.lastIndexOf("/");
  return cut === -1
    ? { folder: "", name: path }
    : { folder: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}

/** The letter a file's change shows: what is staged, else what is not. */
export function statusLetter(file: GitClientFile): string {
  if (file.conflicted) return "!";
  if (file.untracked) return "U";
  const kind = file.index ?? file.workingTree;
  switch (kind) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "typechange":
      return "T";
    default:
      return "M";
  }
}
