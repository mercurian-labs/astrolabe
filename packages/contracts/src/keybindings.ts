import * as Schema from "effect/Schema";
import { ForwardCompatibleArray, TrimmedString } from "./baseSchemas.ts";

const MAX_KEYBINDING_VALUE_LENGTH = 64;
const MAX_KEYBINDING_WHEN_LENGTH = 256;
export const MAX_WHEN_EXPRESSION_DEPTH = 64;
export const MAX_SCRIPT_ID_LENGTH = 24;
export const MAX_KEYBINDINGS_COUNT = 256;

export const THREAD_JUMP_KEYBINDING_COMMANDS = [
  "thread.jump.1",
  "thread.jump.2",
  "thread.jump.3",
  "thread.jump.4",
  "thread.jump.5",
  "thread.jump.6",
  "thread.jump.7",
  "thread.jump.8",
  "thread.jump.9",
] as const;
export type ThreadJumpKeybindingCommand = (typeof THREAD_JUMP_KEYBINDING_COMMANDS)[number];

export const MODEL_PICKER_JUMP_KEYBINDING_COMMANDS = [
  "modelPicker.jump.1",
  "modelPicker.jump.2",
  "modelPicker.jump.3",
  "modelPicker.jump.4",
  "modelPicker.jump.5",
  "modelPicker.jump.6",
  "modelPicker.jump.7",
  "modelPicker.jump.8",
  "modelPicker.jump.9",
] as const;
export type ModelPickerJumpKeybindingCommand =
  (typeof MODEL_PICKER_JUMP_KEYBINDING_COMMANDS)[number];

const THREAD_KEYBINDING_COMMANDS = [
  "thread.stop",
  "thread.steerQueuedMessage",
  "thread.editQueuedMessage",
  "thread.previous",
  "thread.next",
  "thread.copyReference",
  "thread.settle",
  "thread.pin",
  "thread.undo",
  ...THREAD_JUMP_KEYBINDING_COMMANDS,
] as const;
export type ThreadKeybindingCommand = (typeof THREAD_KEYBINDING_COMMANDS)[number];

const MODEL_PICKER_KEYBINDING_COMMANDS = [
  "modelPicker.toggle",
  "modelPicker.previousProvider",
  "modelPicker.nextProvider",
  ...MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
] as const;
export type ModelPickerKeybindingCommand = (typeof MODEL_PICKER_KEYBINDING_COMMANDS)[number];

/**
 * Astrolabe: commands the client's command registry runs (`apps/web/src/whichKey/commands.ts`),
 * reached from the keyboard menu, the Command Palette's aliases, and shortcuts alike.
 */
export const ASTROLABE_KEYBINDING_COMMANDS = [
  "commandLine.open",
  "section.new",
  "section.threads",
  "section.wikis",
  "section.repositories",
  "section.pullRequests",
  "section.usage",
  "section.settings",
  "chatTab.next",
  "chatTab.previous",
  "chatTab.close",
  "pane.splitRight",
  "pane.splitDown",
  "pane.close",
  "pane.toggleMaximized",
  "pane.toggleFullScreen",
  "focus.left",
  "focus.down",
  "focus.up",
  "focus.right",
  "scroll.down",
  "scroll.up",
  "wiki.findDocument",
  "tab.close",
  "draft.write",
  "buffer.open",
  "document.open",
  "search.clearHighlight",
] as const;
export type AstrolabeKeybindingCommand = (typeof ASTROLABE_KEYBINDING_COMMANDS)[number];

/** Astrolabe: the Markdown editors' formatting commands, which each editor binds itself. */
export const MARKDOWN_KEYBINDING_COMMANDS = [
  "markdown.bold",
  "markdown.italic",
  "markdown.code",
  "markdown.strikethrough",
  "markdown.highlight",
  "markdown.link",
] as const;
export type MarkdownKeybindingCommand = (typeof MARKDOWN_KEYBINDING_COMMANDS)[number];

export const STATIC_KEYBINDING_COMMANDS = [
  "sidebar.toggle",
  "navigation.back",
  "navigation.forward",
  "terminal.toggle",
  "terminal.split",
  "terminal.splitVertical",
  "terminal.new",
  "terminal.close",
  "rightPanel.toggle",
  "rightPanel.new",
  "threadPanel.toggle",
  "rightPanel.toggleMaximized",
  "rightPanel.close",
  "view.reopenClosed",
  "pullRequest.copyNumber",
  "diff.toggle",
  "preview.toggle",
  "preview.refresh",
  "preview.focusUrl",
  "preview.zoomIn",
  "preview.zoomOut",
  "preview.resetZoom",
  "commandPalette.toggle",
  // Astrolabe: the keyboard (which-key) menu, which `mod+k` opens; the palette is inside it.
  "whichKey.open",
  "filePicker.toggle",
  "projectSearch.toggle",
  "usage.open",
  "theme.select",
  "appearance.cycle",
  "themeEditor.toggle",
  "composer.stash",
  "composer.sendAlternate",
  "composer.sendBackground",
  "composer.sendAndNewThread",
  "composer.host",
  "composer.cycleHost",
  "composer.effort",
  "composer.increaseEffort",
  "composer.decreaseEffort",
  "composer.mode",
  "composer.workspace",
  "composer.previousWorktree",
  "composer.branch",
  "chat.new",
  "chat.newLocal",
  "chat.newWithoutProject",
  "chat.find",
  "editor.openFavorite",
  "usage.cost",
  "usage.tokens",
  "usage.limits",
  "usage.period.day",
  "usage.period.week",
  "usage.period.month",
  "usage.period.quarter",
  ...MODEL_PICKER_KEYBINDING_COMMANDS,
  ...THREAD_KEYBINDING_COMMANDS,
  // Astrolabe
  ...ASTROLABE_KEYBINDING_COMMANDS,
  ...MARKDOWN_KEYBINDING_COMMANDS,
] as const;

export const SCRIPT_RUN_COMMAND_PATTERN = Schema.TemplateLiteral([
  Schema.Literal("script."),
  Schema.NonEmptyString.check(
    Schema.isMaxLength(MAX_SCRIPT_ID_LENGTH),
    Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
  ),
  Schema.Literal(".run"),
]);

export const KeybindingCommand = Schema.Union([
  Schema.Literals(STATIC_KEYBINDING_COMMANDS),
  SCRIPT_RUN_COMMAND_PATTERN,
]);
export type KeybindingCommand = typeof KeybindingCommand.Type;

export const KeybindingValue = TrimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_KEYBINDING_VALUE_LENGTH),
);

export const KeybindingWhen = TrimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_KEYBINDING_WHEN_LENGTH),
);
/**
 * Astrolabe: a rule whose command starts with `-` removes the matching default instead of adding
 * a binding (VS Code's convention): `{ "key": "menu t ]", "command": "-chatTab.next" }`.
 */
export const KeybindingRemovalCommand = Schema.TemplateLiteral([
  Schema.Literal("-"),
  KeybindingCommand,
]);
export type KeybindingRemovalCommand = typeof KeybindingRemovalCommand.Type;
export const KeybindingRuleCommand = Schema.Union([KeybindingCommand, KeybindingRemovalCommand]);
export type KeybindingRuleCommand = typeof KeybindingRuleCommand.Type;

/**
 * A rule's `key` is its trigger: a shortcut (`mod+k`), or, in Astrolabe, menu keys for the
 * keyboard menu (`menu g w`) or an alias for the Command Palette (`:q[uit]`).
 */
export const KeybindingRule = Schema.Struct({
  key: KeybindingValue,
  // Astrolabe: or a `-command` removal.
  command: KeybindingRuleCommand,
  when: Schema.optional(KeybindingWhen),
});
export type KeybindingRule = typeof KeybindingRule.Type;

export const KeybindingsConfig = Schema.Array(KeybindingRule).check(
  Schema.isMaxLength(MAX_KEYBINDINGS_COUNT),
);
export type KeybindingsConfig = typeof KeybindingsConfig.Type;

export const KeybindingShortcut = Schema.Struct({
  key: KeybindingValue,
  metaKey: Schema.Boolean,
  ctrlKey: Schema.Boolean,
  shiftKey: Schema.Boolean,
  altKey: Schema.Boolean,
  modKey: Schema.Boolean,
});
export type KeybindingShortcut = typeof KeybindingShortcut.Type;

export const PreviewForwardedShortcut = Schema.Struct({
  command: KeybindingCommand,
  shortcut: KeybindingShortcut,
});
export type PreviewForwardedShortcut = typeof PreviewForwardedShortcut.Type;

const KeybindingWhenNodeRef = Schema.suspend(
  (): Schema.Codec<KeybindingWhenNode> => KeybindingWhenNode,
);
export const KeybindingWhenNode = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("identifier"),
    name: Schema.NonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("not"),
    node: KeybindingWhenNodeRef,
  }),
  Schema.Struct({
    type: Schema.Literal("and"),
    left: KeybindingWhenNodeRef,
    right: KeybindingWhenNodeRef,
  }),
  Schema.Struct({
    type: Schema.Literal("or"),
    left: KeybindingWhenNodeRef,
    right: KeybindingWhenNodeRef,
  }),
]);
export type KeybindingWhenNode =
  | { type: "identifier"; name: string }
  | { type: "not"; node: KeybindingWhenNode }
  | { type: "and"; left: KeybindingWhenNode; right: KeybindingWhenNode }
  | { type: "or"; left: KeybindingWhenNode; right: KeybindingWhenNode };

export const ResolvedKeybindingRule = Schema.Struct({
  command: KeybindingCommand,
  shortcut: KeybindingShortcut,
  whenAst: Schema.optional(KeybindingWhenNode),
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });
export type ResolvedKeybindingRule = typeof ResolvedKeybindingRule.Type;

/**
 * Decoding drops those rules instead of failing the whole payload —
 * rejecting the config would take down the connection over a shortcut the
 * client couldn't dispatch anyway.
 */
export const ResolvedKeybindingsConfig = ForwardCompatibleArray(ResolvedKeybindingRule).check(
  Schema.isMaxLength(MAX_KEYBINDINGS_COUNT),
);
export type ResolvedKeybindingsConfig = typeof ResolvedKeybindingsConfig.Type;

/**
 * Astrolabe: the triggers beside shortcuts, as the server resolved them (defaults merged, removals
 * applied). A `menu` trigger's sequence is the keys pressed in the open keyboard menu; an alias is
 * matched as Vim matches an ex name, by any abbreviation down to its `shortest` letters (`:q[uit]`
 * is 1).
 */
export const ResolvedKeybindingTrigger = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("menu"),
    command: KeybindingCommand,
    sequence: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    kind: Schema.Literal("alias"),
    command: KeybindingCommand,
    name: Schema.NonEmptyString,
    shortest: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
]);
export type ResolvedKeybindingTrigger = typeof ResolvedKeybindingTrigger.Type;

/**
 * Astrolabe: sent beside `keybindings` in its own optional field, so older clients (which require
 * a shortcut on every rule) never see it. `unboundCommands` are commands a `-command` rule left
 * with no shortcut at all, which a client's own default merge must not give back.
 */
export const ResolvedKeybindingTriggers = Schema.Struct({
  triggers: ForwardCompatibleArray(ResolvedKeybindingTrigger).check(
    Schema.isMaxLength(MAX_KEYBINDINGS_COUNT),
  ),
  unboundCommands: ForwardCompatibleArray(KeybindingCommand),
});
export type ResolvedKeybindingTriggers = typeof ResolvedKeybindingTriggers.Type;

export class KeybindingsConfigError extends Schema.TaggedError<KeybindingsConfigError>()(
  "KeybindingsConfigParseError",
  {
    configPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Unable to parse keybindings config at ${this.configPath}: ${this.detail}`;
  }
}
