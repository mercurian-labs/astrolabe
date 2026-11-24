import {
  STATIC_KEYBINDING_COMMANDS,
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  parseKeybindingShortcut,
  parseKeybindingWhenExpression,
  US_SHIFTED_TO_UNSHIFTED_KEYS,
} from "@t3tools/shared/keybindings";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import { shortcutConflictKey, shortcutKeyFromEvent } from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";
import { METRIC_OPTIONS, WINDOW_OPTIONS } from "../usage/usageShortcuts";

// Rank every usage command; mixing rank and alphabetical comparisons makes order input-dependent.
const usageCommandOrder = new Map<KeybindingCommand, number>(
  [
    "usage.open" as const,
    ...[...METRIC_OPTIONS, ...WINDOW_OPTIONS].map((option) => option.command),
  ].map((command, index) => [command, index]),
);

const firstUsageCommand = METRIC_OPTIONS[0].command;

function compareCommands(
  left: KeybindingCommand,
  right: KeybindingCommand,
  key: (command: KeybindingCommand) => string,
): number {
  const leftRank = usageCommandOrder.get(left);
  const rightRank = usageCommandOrder.get(right);
  if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
  return key(leftRank === undefined ? left : firstUsageCommand).localeCompare(
    key(rightRank === undefined ? right : firstUsageCommand),
  );
}

export type KeybindingSource = "Default" | "Custom" | "Project";

export interface KeybindingRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly key: string;
  readonly when: string;
  readonly source: KeybindingSource;
  readonly isUnassigned: boolean;
  readonly defaultKey: string | null;
  readonly defaultWhen: string;
  readonly binding: ResolvedKeybindingRule;
  readonly conflicts: ReadonlyArray<string>;
}

export type WhenVariableOption = string;
export type KeybindingCommandOption = KeybindingCommand;

const CORE_WHEN_VARIABLES = [
  "terminalFocus",
  "terminalOpen",
  "previewOpen",
  "isWeb",
  "isDesktop",
  "true",
  "false",
] as const;

const DEFAULT_WHEN_VARIABLES = new Set<string>(CORE_WHEN_VARIABLES);
for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
  collectWhenIdentifiersFromNode(binding.whenAst, DEFAULT_WHEN_VARIABLES);
}

export const DEFAULT_WHEN_VARIABLE =
  [...DEFAULT_WHEN_VARIABLES].find(
    (identifier) => identifier !== "true" && identifier !== "false",
  ) ?? "terminalFocus";
const KNOWN_WHEN_VARIABLES = new Set(DEFAULT_WHEN_VARIABLES);

export function shortcutToKeybindingInput(shortcut: KeybindingShortcut): string {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("mod");
  if (shortcut.metaKey) parts.push("meta");
  if (shortcut.ctrlKey) parts.push("ctrl");
  if (shortcut.altKey) parts.push("alt");
  if (shortcut.shiftKey) parts.push("shift");
  parts.push(shortcut.key === " " ? "space" : shortcut.key === "escape" ? "esc" : shortcut.key);
  return parts.join("+");
}

export function whenAstToExpression(node: KeybindingWhenNode | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${wrapWhenExpression(node.node)}`;
    case "and":
      return `${wrapWhenExpression(node.left)} && ${wrapWhenExpression(node.right)}`;
    case "or":
      return `${wrapWhenExpression(node.left)} || ${wrapWhenExpression(node.right)}`;
  }
}

export function whenNodeRemoveLabel(
  node: KeybindingWhenNode,
  depth: number,
  resolve: MessageResolver = m,
): string {
  if (depth === 0) return resolve(msg("Clear all conditions"));
  if (node.type === "identifier" || (node.type === "not" && node.node.type === "identifier")) {
    return resolve(msg("Remove condition"));
  }
  return resolve(msg("Remove group and its conditions"));
}

function wrapWhenExpression(node: KeybindingWhenNode): string {
  if (node.type === "identifier" || node.type === "not") return whenAstToExpression(node);
  return `(${whenAstToExpression(node)})`;
}

export function parseWhenExpressionDraft(
  expression: string,
  resolve: MessageResolver = m,
): { ok: true; value: KeybindingWhenNode | undefined } | { ok: false; message: string } {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };

  const ast = parseKeybindingWhenExpression(trimmed);
  if (!ast) {
    return {
      ok: false,
      message: resolve(msg("Use variables with !, &&, ||, and parentheses.")),
    };
  }

  return { ok: true, value: ast };
}

function sourceForBinding(binding: ResolvedKeybindingRule): KeybindingSource {
  if (String(binding.command).startsWith("script.")) {
    const source: KeybindingSource = "Project";
    return source;
  }

  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);
  const isDefault = DEFAULT_RESOLVED_KEYBINDINGS.some(
    (entry) =>
      entry.command === binding.command &&
      shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
      whenAstToExpression(entry.whenAst) === bindingWhen,
  );

  const source: KeybindingSource = isDefault ? "Default" : "Custom";
  return source;
}

function defaultBindingForBinding(
  binding: ResolvedKeybindingRule,
): ResolvedKeybindingRule | undefined {
  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);

  return (
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command &&
        shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
        whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    (bindingWhen === "false"
      ? DEFAULT_RESOLVED_KEYBINDINGS.find(
          (entry) =>
            entry.command === binding.command &&
            shortcutToKeybindingInput(entry.shortcut) === bindingKey,
        )
      : undefined) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command && whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find((entry) => entry.command === binding.command)
  );
}

function keybindingRowId(command: KeybindingCommand, key: string, when: string): string {
  return `${command}\u0000${key}\u0000${when}`;
}

function conflictsWithWhen(leftWhen: string, rightWhen: string): boolean {
  if (leftWhen === "false" || rightWhen === "false") return false;
  return leftWhen.length === 0 || rightWhen.length === 0 || leftWhen === rightWhen;
}

export function keybindingConflictLabels(
  rows: ReadonlyArray<KeybindingRow>,
  input: { readonly rowId: string; readonly key: string; readonly when: string },
  platform = navigator.platform,
  resolve: MessageResolver = m,
): ReadonlyArray<string> {
  if (input.key.trim().length === 0) return [];
  const shortcut = parseKeybindingShortcut(input.key);
  if (!shortcut) return [];
  // Compare resolved chords so mod+k and ctrl+k collide where mod is Ctrl.
  const conflictKey = shortcutConflictKey(shortcut, platform);
  const conflicts: Array<string> = [];
  for (const candidate of rows) {
    if (
      candidate.id !== input.rowId &&
      shortcutConflictKey(candidate.binding.shortcut, platform) === conflictKey &&
      conflictsWithWhen(candidate.when, input.when)
    ) {
      conflicts.push(commandLabel(candidate.command, resolve));
    }
  }
  return [...new Set(conflicts)].toSorted();
}

export interface KeybindingGroup<
  Row extends { readonly command: KeybindingCommand } = KeybindingRow,
> {
  readonly id: string;
  readonly title: string;
  readonly rows: ReadonlyArray<Row>;
}

const KEYBINDING_GROUPS = [
  {
    id: "navigation",
    title: msg("Navigation"),
    prefixes: [
      "sidebar",
      "rightPanel",
      "commandPalette",
      // Astrolabe: the keyboard menu, the Command Palette, and the commands they reach.
      "whichKey",
      "commandLine",
      "section",
      "chatTab",
      "pane",
      "tab",
      "buffer",
      "document",
      "wiki",
      "filePicker",
      "projectSearch",
      "editor",
    ],
  },
  { id: "threads", title: msg("Threads"), prefixes: ["thread", "chat", "pullRequest"] },
  // Astrolabe: `draft` is the command line's `:w`.
  { id: "composer", title: msg("Composer"), prefixes: ["composer", "modelPicker", "draft"] },
  // Astrolabe: the editors' own keys: formatting, finding and Vim's search highlight, a code
  // file's editing, its changes since its last commit, the outline picker, and its language
  // server's problems and features.
  {
    id: "editor",
    title: msg("Editors"),
    prefixes: [
      "markdown",
      "search",
      "edit",
      "code",
      "hunk",
      "outline",
      "diagnostic",
      "lsp",
      "run",
      "file",
    ],
  },
  { id: "terminal", title: msg("Terminal"), prefixes: ["terminal"] },
  { id: "preview", title: msg("Preview & diff"), prefixes: ["preview", "diff"] },
  {
    id: "appearance",
    title: msg("Appearance"),
    prefixes: ["theme", "appearance", "themeEditor"],
  },
  { id: "scripts", title: msg("Project scripts"), prefixes: ["script"] },
] as const;
const OTHER_KEYBINDING_GROUP = {
  id: "other",
  title: msg("Other", { $context: "keybinding group" }),
} as const;

function keybindingGroupFor(command: KeybindingCommand): { id: string; title: string } {
  const prefix = String(command).split(".")[0] ?? "";
  return (
    KEYBINDING_GROUPS.find((group) => (group.prefixes as ReadonlyArray<string>).includes(prefix)) ??
    OTHER_KEYBINDING_GROUP
  );
}

export function groupKeybindingRows<
  Row extends { readonly command: KeybindingCommand } = KeybindingRow,
>(rows: ReadonlyArray<Row>): ReadonlyArray<KeybindingGroup<Row>> {
  const rowsByGroup = new Map<string, Array<Row>>();
  for (const row of rows) {
    const group = keybindingGroupFor(row.command);
    const bucket = rowsByGroup.get(group.id);
    if (bucket) bucket.push(row);
    else rowsByGroup.set(group.id, [row]);
  }
  return [...KEYBINDING_GROUPS, OTHER_KEYBINDING_GROUP].flatMap((group) => {
    const groupRows = rowsByGroup.get(group.id);
    return groupRows ? [{ id: group.id, title: group.title, rows: groupRows }] : [];
  });
}

/**
 * Astrolabe: shortcut rows and leader or ex rows in one order: by command as the page sorts
 * them, a command's shortcuts first.
 */
export function mergeKeybindingRows<Other extends { readonly command: KeybindingCommand }>(
  rows: ReadonlyArray<KeybindingRow>,
  others: ReadonlyArray<Other>,
): ReadonlyArray<KeybindingRow | Other> {
  return [...rows, ...others].toSorted((left, right) =>
    compareCommands(left.command, right.command, (command) => command),
  );
}

export function buildKeybindingRows(
  keybindings: ResolvedKeybindingsConfig,
  platform = navigator.platform,
  resolve: MessageResolver = m,
): ReadonlyArray<KeybindingRow> {
  const rowsById = new Map<string, KeybindingRow>();
  for (const binding of keybindings) {
    const defaultBinding = defaultBindingForBinding(binding);
    const key = shortcutToKeybindingInput(binding.shortcut);
    const when = whenAstToExpression(binding.whenAst);
    const id = keybindingRowId(binding.command, key, when);
    rowsById.set(id, {
      id,
      command: binding.command,
      key,
      when,
      source: sourceForBinding(binding),
      isUnassigned:
        when === "false" &&
        defaultBinding !== undefined &&
        key === shortcutToKeybindingInput(defaultBinding.shortcut),
      defaultKey: defaultBinding ? shortcutToKeybindingInput(defaultBinding.shortcut) : null,
      defaultWhen: whenAstToExpression(defaultBinding?.whenAst),
      binding,
      conflicts: [],
    });
  }
  const rows = [...rowsById.values()];

  const rowsWithConflicts = rows.map((row) => {
    const conflicts = keybindingConflictLabels(
      rows,
      {
        rowId: row.id,
        key: row.key,
        when: row.when,
      },
      platform,
      resolve,
    );
    return conflicts.length > 0
      ? Object.assign({}, row, { conflicts: [...new Set(conflicts)].toSorted() })
      : row;
  });

  rowsWithConflicts.sort((left, right) => {
    const commandCompare = compareCommands(left.command, right.command, (command) => command);
    if (commandCompare !== 0) return commandCompare;
    return left.key.localeCompare(right.key);
  });

  return rowsWithConflicts;
}

function collectWhenIdentifiersFromNode(
  node: KeybindingWhenNode | undefined,
  identifiers: Set<string>,
): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
      identifiers.add(node.name);
      return;
    case "not":
      collectWhenIdentifiersFromNode(node.node, identifiers);
      return;
    case "and":
    case "or":
      collectWhenIdentifiersFromNode(node.left, identifiers);
      collectWhenIdentifiersFromNode(node.right, identifiers);
      return;
  }
}

export function isKnownWhenVariable(identifier: string): boolean {
  return KNOWN_WHEN_VARIABLES.has(identifier);
}

export function unknownWhenVariables(node: KeybindingWhenNode | undefined): ReadonlyArray<string> {
  const identifiers = new Set<string>();
  collectWhenIdentifiersFromNode(node, identifiers);
  return [...identifiers].filter((identifier) => !isKnownWhenVariable(identifier)).toSorted();
}

export function buildWhenVariableOptions(): ReadonlyArray<WhenVariableOption> {
  return [...KNOWN_WHEN_VARIABLES].toSorted((left, right) => {
    const leftCoreIndex = CORE_WHEN_VARIABLES.indexOf(left as (typeof CORE_WHEN_VARIABLES)[number]);
    const rightCoreIndex = CORE_WHEN_VARIABLES.indexOf(
      right as (typeof CORE_WHEN_VARIABLES)[number],
    );
    if (leftCoreIndex !== -1 || rightCoreIndex !== -1) {
      return (
        (leftCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : leftCoreIndex) -
        (rightCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : rightCoreIndex)
      );
    }
    return left.localeCompare(right);
  });
}

export function buildKeybindingCommandOptions(
  keybindings: ResolvedKeybindingsConfig,
  resolve: MessageResolver = m,
): ReadonlyArray<KeybindingCommandOption> {
  const commands = new Set<KeybindingCommand>(STATIC_KEYBINDING_COMMANDS);
  for (const binding of keybindings) {
    commands.add(binding.command);
  }
  return [...commands].toSorted((left, right) =>
    compareCommands(left, right, (command) => commandLabel(command, resolve)),
  );
}

/** Astrolabe: labels the command ids do not spell out well. */
const ASTROLABE_COMMAND_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "commandPalette.toggle": msg("Search"),
  "commandLine.open": msg("Command Palette"),
  "section.new": msg("New Thread or Document"),
  "section.threads": msg("Section: Agents"),
  "section.repositories": msg("Section: Projects"),
  "section.pullRequests": msg("Section: Changes"),
  "section.issues": msg("Section: Issues"),
  "tab.close": msg("Close Tab or Pane Tab"),
  "rightPanel.close": msg("Close Focused Tab"),
  "draft.write": msg("Send Draft or Save Note"),
  "buffer.open": msg("Switch to Thread"),
  "document.open": msg("Open Document"),
  "focus.left": msg("Focus Left"),
  "focus.down": msg("Focus Down"),
  "focus.up": msg("Focus Up"),
  "focus.right": msg("Focus Right"),
  "scroll.down": msg("Scroll Down"),
  "scroll.up": msg("Scroll Up"),
  "search.find": msg("Find in Editor"),
  "hunk.toggle": msg("Show or Hide Change"),
  "hunk.expandAll": msg("Show All Changes"),
  "hunk.restore": msg("Restore Change"),
  "hunk.next": msg("Next Change"),
  "hunk.previous": msg("Previous Change"),
  "hunk.toggleBase": msg("Compare With HEAD or This Turn"),
  "outline.open": msg("Go to Symbol in File"),
  "lsp.projectSymbols": msg("Go to Symbol in Project"),
  "diagnostic.next": msg("Next Problem"),
  "diagnostic.previous": msg("Previous Problem"),
  "lsp.complete": msg("Show Completions"),
  "lsp.hover": msg("Show Hover"),
  "lsp.signatureHelp": msg("Show Signature Help"),
  "lsp.definition": msg("Go to Definition"),
  "lsp.declaration": msg("Go to Declaration"),
  "lsp.typeDefinition": msg("Go to Type Definition"),
  "lsp.implementation": msg("Go to Implementation"),
  "lsp.references": msg("Find References"),
  "lsp.incomingCalls": msg("Show Incoming Calls"),
  "lsp.outgoingCalls": msg("Show Outgoing Calls"),
  "lsp.rename": msg("Rename Symbol"),
  "lsp.undoRename": msg("Undo Rename or Code Action"),
  "lsp.format": msg("Format Document"),
  "lsp.codeActions": msg("Show Code Actions"),
  "lsp.restartServer": msg("Restart Language Server"),
  "lsp.stopServer": msg("Stop Language Server"),
  "lsp.trustProject": msg("Trust Project"),
  "lsp.checkServers": msg("Check Language Servers"),
  "lsp.viewLogs": msg("View Language Server Logs"),
  "lsp.selectInterpreter": msg("Select Python Interpreter"),
  "lsp.toggleInlayHints": msg("Toggle Inlay Hints"),
  "lsp.toggleInlineDiagnostics": msg("Toggle Inline Diagnostics"),
  "run.atCursor": msg("Run at Cursor"),
  "run.last": msg("Run Last"),
  "file.save": msg("Save File"),
  "file.toggleEdit": msg("Files: Edit or Preview File"),
  "edit.undo": msg("Undo"),
  "edit.redo": msg("Redo"),
  "multibuffer.expand": msg("Show More Lines Around Excerpt"),
  "multibuffer.openExcerpt": msg("Open Excerpt in Its File"),
  "multibuffer.nextFile": msg("Next File in Results"),
  "multibuffer.previousFile": msg("Previous File in Results"),
  "multibuffer.problems": msg("Projects: Show Problems"),
  "projectSearch.openInEditor": msg("Open Search Results in Editor"),
  "repository.localGraph": msg("Projects: Open Local Graph"),
  "tab.toggleLink": msg("Tabs: Link or Unlink Tab"),
  "tab.newLinked": msg("Tabs: New Linked Tab"),
};

const COMMAND_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "workspace.focusNext": msg("Focus Next Workspace Area"),
  "workspace.focusPrevious": msg("Focus Previous Workspace Area"),
  "composer.sendAlternate": msg("Composer: Opposite Queue or Steer Action"),
  "composer.sendBackground": msg("Composer: Start in Background"),
  "composer.sendAndNewThread": msg("Composer: Send and Start New Thread"),
  "composer.dictation": msg("Composer: Start or Finish Dictation"),
  "thread.steerQueuedMessage": msg("Queue: Send First Queued Message"),
  "thread.editQueuedMessage": msg("Queue: Edit Last Queued Message"),
  "thread.copyReference": msg("Pull Request: Copy Link or Thread"),
  "sidebar.toggle": msg("Sidebar: Toggle"),
  "navigation.back": msg("Navigation: Back"),
  "navigation.forward": msg("Navigation: Forward"),
  "terminal.toggle": msg("Terminal: Toggle"),
  "terminal.split": msg("Terminal: Split"),
  "terminal.splitVertical": msg("Terminal: Split Vertical"),
  "terminal.new": msg("Terminal: New"),
  "terminal.close": msg("Terminal: Close"),
  "rightPanel.toggle": msg("Right Panel: Toggle"),
  "rightPanel.new": msg("Right Panel: New"),
  "threadPanel.toggle": msg("Thread Panel: Toggle"),
  "rightPanel.toggleMaximized": msg("Right Panel: Toggle Maximized"),
  "rightPanel.close": msg("Right Panel: Close"),
  "pullRequest.copyNumber": msg("Pull Request: Copy Number"),
  "diff.toggle": msg("Diff: Toggle"),
  "preview.toggle": msg("Preview: Toggle"),
  "preview.refresh": msg("Preview: Refresh"),
  "preview.zoomIn": msg("Preview: Zoom In"),
  "preview.zoomOut": msg("Preview: Zoom Out"),
  "preview.resetZoom": msg("Preview: Reset Zoom"),
  "commandPalette.toggle": msg("Command Palette: Toggle"),
  "filePicker.toggle": msg("File Picker: Toggle"),
  "projectSearch.toggle": msg("Project Search: Toggle"),
  "usage.open": msg("Usage: Open"),
  "theme.select": msg("Theme: Select"),
  "appearance.cycle": msg("Appearance: Cycle"),
  "themeEditor.toggle": msg("Theme Editor: Toggle"),
  "composer.stash": msg("Composer: Stash"),
  "composer.host": msg("Composer: Host"),
  "composer.cycleHost": msg("Composer: Cycle Host"),
  "composer.effort": msg("Composer: Effort"),
  "composer.increaseEffort": msg("Composer: Increase Effort"),
  "composer.decreaseEffort": msg("Composer: Decrease Effort"),
  "composer.mode": msg("Composer: Mode"),
  "composer.workspace": msg("Composer: Workspace"),
  "composer.previousWorktree": msg("Composer: Previous Worktree"),
  "composer.branch": msg("Composer: Branch"),
  "chat.new": msg("Chat: New"),
  "chat.newLocal": msg("Chat: New Local"),
  "chat.newWithoutProject": msg("Chat: New Without Project"),
  "chat.find": msg("Chat: Find"),
  "editor.openFavorite": msg("Editor: Open Favorite"),
  "modelPicker.toggle": msg("Model Picker: Toggle"),
  "modelPicker.previousProvider": msg("Model Picker: Previous Provider"),
  "modelPicker.nextProvider": msg("Model Picker: Next Provider"),
  "thread.stop": msg("Thread: Stop"),
  "thread.previous": msg("Thread: Previous"),
  "thread.next": msg("Thread: Next"),
  "thread.settle": msg("Thread: Settle"),
  "thread.pin": msg("Thread: Pin"),
  "thread.regenerateTitle": msg("Thread: Regenerate Title"),
  "thread.undo": msg("Thread: Undo"),
};

// Whole labels: search titles keep the encoded message, which cannot nest another one.
const USAGE_COMMAND_LABELS: Record<
  (typeof METRIC_OPTIONS)[number]["command"] | (typeof WINDOW_OPTIONS)[number]["command"],
  string
> = {
  "usage.cost": msg("Usage: Cost"),
  "usage.tokens": msg("Usage: Tokens"),
  "usage.limits": msg("Usage: Limits"),
  "usage.period.day": msg("Usage: Period: Past 24h"),
  "usage.period.week": msg("Usage: Period: 7 days"),
  "usage.period.month": msg("Usage: Period: 30 days"),
  "usage.period.quarter": msg("Usage: Period: 90 days"),
};

const LATE_COMMAND_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "view.reopenClosed": msg("Reopen Closed Tab"),
  "preview.focusUrl": msg("Preview: Focus URL"),
  "preview.find": msg("Preview: Find on Page"),
};

export function commandLabel(command: KeybindingCommand, resolve: MessageResolver = m): string {
  // Astrolabe: the which-key menu, Search (upstream's palette), and the Command Palette.
  if (command === "whichKey.open") return resolve(msg("Keyboard Menu: Open"));
  const astrolabeLabel = ASTROLABE_COMMAND_LABELS[command];
  if (astrolabeLabel) return resolve(astrolabeLabel);
  const label = COMMAND_LABELS[command];
  if (label) return resolve(label);
  const usageLabel = USAGE_COMMAND_LABELS[command as keyof typeof USAGE_COMMAND_LABELS];
  if (usageLabel) return resolve(usageLabel);
  const lateLabel = LATE_COMMAND_LABELS[command];
  if (lateLabel) return resolve(lateLabel);
  const raw = String(command);
  if (raw.startsWith("thread.jump.")) {
    return resolve(msg("Thread: Jump: {n}", { n: raw.slice("thread.jump.".length) }));
  }
  if (raw.startsWith("modelPicker.jump.")) {
    return resolve(msg("Model Picker: Jump: {n}", { n: raw.slice("modelPicker.jump.".length) }));
  }
  if (raw.startsWith("script.") && raw.endsWith(".run")) {
    return resolve(
      msg("Run Script: {name}", {
        name: titleCaseCommandSegment(raw.slice("script.".length, -".run".length)),
      }),
    );
  }
  return raw.split(".").map(titleCaseCommandSegment).join(": ");
}

function titleCaseCommandSegment(segment: string): string {
  const words: Array<string> = [];
  for (const part of segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[-_\s]+/)) {
    if (part.length > 0) {
      words.push(part.slice(0, 1).toUpperCase() + part.slice(1));
    }
  }
  return words.join(" ");
}

function recordedLayoutShortcutKey(
  event: Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "altKey">,
): string {
  const physicalKey = shortcutKeyFromEvent(event);
  const layoutKey = event.key.toLowerCase();
  if (event.altKey || layoutKey.length !== 1) return physicalKey;
  // Normalize only US shifted glyphs at their US position. Other layouts can
  // produce the same glyph without Shift or at a different position.
  const unshiftedKey = event.shiftKey ? US_SHIFTED_TO_UNSHIFTED_KEYS.get(layoutKey) : undefined;
  return unshiftedKey === physicalKey ? physicalKey : layoutKey;
}

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (/^f\d{1,2}$/.test(normalized)) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

export function keybindingFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: string,
  options?: {
    readonly layoutCharacter?: boolean;
  },
): string | null {
  const keyToken = normalizeShortcutKeyToken(
    options?.layoutCharacter ? recordedLayoutShortcutKey(event) : shortcutKeyFromEvent(event),
  );
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(keyToken);
  return parts.join("+");
}
