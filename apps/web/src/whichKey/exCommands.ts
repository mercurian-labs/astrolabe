import type { KeybindingCommand, ResolvedKeybindingTrigger } from "@t3tools/contracts";
import { formatAlias } from "@t3tools/shared/keybindingTriggers";

/**
 * Astrolabe: the command palette as a command line, read as Vim reads one: a command's alias
 * (from the keybindings' `:name[tail]` rules) or any abbreviation of it down to its shortest
 * form (`q`, `qu`, `quit`), an optional `!`, and an argument after a space.
 */

/** An alias as the Command Palette's field takes it, after its chevron: `q[uit]`. */
export function aliasLabel(alias: { readonly name: string; readonly shortest: number }): string {
  return formatAlias(alias).slice(1);
}

export interface ExCommand {
  readonly command: KeybindingCommand;
  readonly bang: boolean;
  /** What follows the command after a space, trimmed: a document or a tab's name. */
  readonly argument: string;
}

/** The text of a command-line query: what follows its leading `:`, or null if it has none. */
export function exLineOf(query: string): string | null {
  return query.startsWith(":") ? query.replace(/^:+/, "").trimStart() : null;
}

/**
 * The palette's field for a query. At the palette's root a query starting with `:` is the
 * Command Palette: the field holds what follows the colon, which a glyph beside it stands for.
 * Anywhere else (Search, a submenu) the field is the query.
 */
export function commandLineField(
  query: string,
  atRoot: boolean,
): { readonly commandLine: boolean; readonly text: string } {
  const commandLine = atRoot && query.startsWith(":");
  return { commandLine, text: commandLine ? query.slice(1) : query };
}

/**
 * The query for what the field now holds: the Command Palette puts its colon back. At Search's
 * root a `:` or `>` typed first is a door to the Command Palette: the query starts with the colon
 * and the field leaves it. In a submenu either is just typed.
 */
export function queryForField(text: string, commandLine: boolean, atRoot: boolean): string {
  if (commandLine) return `:${text}`;
  return atRoot && text.startsWith(">") ? `:${text.slice(1)}` : text;
}

/**
 * The command an ex line names among `triggers`' aliases, or null when it names none (an
 * editor's own command, such as `:s/a/b/` or `:12`, or a typo). A full name wins over an
 * abbreviation, and a later rule (the user's, after the defaults) over an earlier one.
 */
export function parseExCommand(
  line: string,
  triggers: ReadonlyArray<ResolvedKeybindingTrigger>,
): ExCommand | null {
  const match = /^([a-z]+)(!?)(?:\s+(.*))?$/i.exec(line.trim());
  if (!match) return null;
  const [, word = "", bang, argument = ""] = match;
  const typed = word.toLowerCase();
  const names = triggers.flatMap((trigger) =>
    trigger.kind === "alias" && typed.length >= trigger.shortest && trigger.name.startsWith(typed)
      ? [trigger]
      : [],
  );
  const named = names.findLast((trigger) => trigger.name === typed) ?? names.at(-1);
  if (!named) return null;
  return { command: named.command, bang: bang === "!", argument: argument.trim() };
}
