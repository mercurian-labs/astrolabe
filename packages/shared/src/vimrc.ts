import type {
  ServerSetVimOptionInput,
  VimMapping,
  VimMappingMode,
  VimMappingTarget,
  VimOptionName,
} from "@t3tools/contracts";

/**
 * Astrolabe: a vimrc of what `@replit/codemirror-vim`'s global `Vim` API can apply: maps and noremaps
 * with mode prefixes, unmaps of the vimrc's own maps, `set` for the package's options, `"` comments.
 * Unappliable lines come back as per-line errors. Reapplying first undoes the last application, so an
 * edit never leaves stale mappings.
 */

/** A mode as the package names it; none is Vim's `:map` (normal, visual, operator-pending). */
type VimContext = "normal" | "visual" | "insert" | "operatorPending";

interface VimrcError {
  /** 1-based, as an editor numbers lines. */
  readonly line: number;
  readonly message: string;
}

type VimrcCommand =
  | {
      readonly kind: "map";
      readonly line: number;
      readonly lhs: string;
      readonly rhs: string;
      readonly context: VimContext | undefined;
      readonly noremap: boolean;
    }
  | {
      readonly kind: "unmap";
      readonly line: number;
      readonly lhs: string;
      readonly context: VimContext | undefined;
    }
  | {
      readonly kind: "set";
      readonly line: number;
      readonly name: string;
      /** A value after `=`, true for `set name`, false for `set noname`, or a toggle (`name!`). */
      readonly value: string | boolean | "toggle";
    };

const MAP_COMMANDS: Readonly<
  Record<string, { context: VimContext | undefined; noremap: boolean }>
> = {
  map: { context: undefined, noremap: false },
  nmap: { context: "normal", noremap: false },
  vmap: { context: "visual", noremap: false },
  xmap: { context: "visual", noremap: false },
  omap: { context: "operatorPending", noremap: false },
  imap: { context: "insert", noremap: false },
  noremap: { context: undefined, noremap: true },
  nnoremap: { context: "normal", noremap: true },
  vnoremap: { context: "visual", noremap: true },
  xnoremap: { context: "visual", noremap: true },
  onoremap: { context: "operatorPending", noremap: true },
  inoremap: { context: "insert", noremap: true },
};

const UNMAP_COMMANDS: Readonly<Record<string, VimContext | undefined>> = {
  unmap: undefined,
  nunmap: "normal",
  vunmap: "visual",
  xunmap: "visual",
  ounmap: "operatorPending",
  iunmap: "insert",
};

/** A line's text without its indent and leading colons (Vim allows `:` in a vimrc). */
const lineSource = (raw: string) => raw.trim().replace(/^:+/, "");

/** Reads a vimrc into the commands it gives, and an error for each line it cannot read. */
export function parseVimrc(text: string): {
  readonly commands: readonly VimrcCommand[];
  readonly errors: readonly VimrcError[];
} {
  const commands: VimrcCommand[] = [];
  const errors: VimrcError[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    const source = lineSource(raw);
    if (source === "" || source.startsWith('"')) continue;
    const [word = "", ...rest] = source.split(/\s+/);
    const map = MAP_COMMANDS[word];
    if (map) {
      const [lhs, ...rhs] = rest;
      if (!lhs || rhs.length === 0) {
        errors.push({ line, message: `${word} needs a key and what it maps to` });
        continue;
      }
      // The right side is the rest of the line, spaces and all.
      const rhsText = source.slice(source.indexOf(lhs, word.length) + lhs.length).trim();
      commands.push({ kind: "map", line, lhs, rhs: rhsText, ...map });
      continue;
    }
    if (word in UNMAP_COMMANDS) {
      if (rest.length !== 1) {
        errors.push({ line, message: `${word} needs one key` });
        continue;
      }
      commands.push({ kind: "unmap", line, lhs: rest[0]!, context: UNMAP_COMMANDS[word] });
      continue;
    }
    if (word === "set" || word === "se") {
      if (rest.length === 0) {
        errors.push({ line, message: "set needs an option" });
        continue;
      }
      for (const argument of rest) commands.push({ kind: "set", line, ...setArgument(argument) });
      continue;
    }
    errors.push({ line, message: `Not supported here: ${word}` });
  }
  return { commands, errors };
}

/** One `set` argument: `name=value`, `name!`, `noname`, or `name`. */
function setArgument(argument: string): { name: string; value: string | boolean | "toggle" } {
  const equals = argument.indexOf("=");
  if (equals > 0) return { name: argument.slice(0, equals), value: argument.slice(equals + 1) };
  if (argument.endsWith("!")) return { name: argument.slice(0, -1), value: "toggle" };
  if (argument.startsWith("no")) return { name: argument.slice(2), value: false };
  return { name: argument, value: true };
}

/** The part of `@replit/codemirror-vim`'s `Vim` a vimrc uses. */
export interface VimrcTarget {
  map(lhs: string, rhs: string, context?: string): void;
  noremap(lhs: string, rhs: string, context?: string): void;
  unmap(lhs: string, context?: string): unknown;
  setOption(name: string, value: unknown): Error | undefined;
  getOption(name: string): unknown;
}

/** What one application did, so the next can undo it. */
interface Applied {
  readonly mapped: Array<{ readonly lhs: string; readonly context: VimContext | undefined }>;
  /** Each option's value before the vimrc first set it. */
  readonly options: Map<string, unknown>;
}

/** A `set` value as the option takes it: numbers for number options. */
function optionValue(current: unknown, value: string | boolean | "toggle"): unknown {
  // `name`, `noname`, and `name!` are for on-off options only.
  if (typeof value === "boolean" || value === "toggle") {
    if (typeof current !== "boolean") return null;
    return value === "toggle" ? !current : value;
  }
  // An on-off option takes no value.
  if (typeof current === "boolean") return null;
  if (typeof current !== "number") return value;
  const number = Number(value);
  return Number.isFinite(number) && value.trim() !== "" ? number : null;
}

/**
 * Applies vimrcs to `target`, each in place of the last: `apply` undoes the previous vimrc's
 * mappings and options, applies this one, and returns an error for each line it could not apply.
 */
export function createVimrcApplier(target: VimrcTarget) {
  let applied: Applied | null = null;

  const undo = () => {
    if (!applied) return;
    for (const { lhs, context } of [...applied.mapped].reverse()) target.unmap(lhs, context);
    for (const [name, value] of applied.options) target.setOption(name, value);
    applied = null;
  };

  return function apply(text: string): readonly VimrcError[] {
    undo();
    const { commands, errors: parseErrors } = parseVimrc(text);
    const errors = [...parseErrors];
    const next: Applied = { mapped: [], options: new Map() };
    for (const command of commands) {
      try {
        if (command.kind === "map") {
          const add = command.noremap ? target.noremap : target.map;
          add.call(target, command.lhs, command.rhs, command.context);
          next.mapped.push({ lhs: command.lhs, context: command.context });
        } else if (command.kind === "unmap") {
          const at = next.mapped.findLastIndex(
            (entry) => entry.lhs === command.lhs && entry.context === command.context,
          );
          if (at === -1) {
            errors.push({ line: command.line, message: `No such mapping: ${command.lhs}` });
            continue;
          }
          target.unmap(command.lhs, command.context);
          next.mapped.splice(at, 1);
        } else {
          const current = target.getOption(command.name);
          if (current instanceof Error) {
            errors.push({ line: command.line, message: current.message });
            continue;
          }
          const value = optionValue(current, command.value);
          const error = value === null ? new Error(`Invalid argument: ${command.name}`) : null;
          const result = error ?? target.setOption(command.name, value);
          if (result instanceof Error) {
            errors.push({ line: command.line, message: result.message });
            continue;
          }
          if (!next.options.has(command.name)) next.options.set(command.name, current);
        }
      } catch (error) {
        errors.push({
          line: command.line,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    applied = next;
    return [...errors].sort((left, right) => left.line - right.line);
  };
}

/**
 * The options the Vim core defines, under each name `set` takes, with their defaults. `filetype`
 * and `langmap` have none: the core reads them from the editor.
 */
const VIM_OPTION_DEFAULTS: Readonly<Record<string, boolean | number | string>> = {
  pcre: true,
  textwidth: 80,
  tw: 80,
  insertModeEscKeysTimeout: 200,
  filetype: "",
  ft: "",
  langmap: "",
  lmap: "",
};

/** Maps as Vim takes them, applying nothing: an ex mapping (`:W`) has no mode. */
function checkMapping(lhs: string, _rhs: string, context?: string) {
  if (lhs !== ":" && lhs.startsWith(":") && context) {
    throw new Error("Mode not supported for ex mappings");
  }
}

/**
 * The errors `createVimrcApplier(Vim)` would give for `text`, without a `Vim` to apply it to: for
 * the server, which reports them as issues.
 */
export function checkVimrc(text: string): readonly VimrcError[] {
  return createVimrcApplier({
    map: checkMapping,
    noremap: checkMapping,
    unmap: () => undefined,
    setOption: () => undefined,
    getOption: (name) =>
      Object.hasOwn(VIM_OPTION_DEFAULTS, name)
        ? VIM_OPTION_DEFAULTS[name]
        : new Error(`Unknown option: ${name}`),
  })(text);
}

// Reading and editing the file line by line, for Settings' mapping rows and options. An edit
// rewrites only the lines that define what it changes, so comments, lines Settings does not show,
// and lines the vimrc cannot apply stay as the user wrote them.

/** A mapping as Settings lists it, and the 1-based line that defines it. */
export interface VimrcMappingRow extends VimMapping {
  readonly line: number;
}

const MODE_PREFIX: Readonly<Record<VimMappingMode, string>> = {
  normal: "n",
  visual: "v",
  insert: "i",
  all: "",
};

/** A row's mode for a mapping's context; operator-pending maps have no row. */
function modeOf(context: VimContext | undefined): VimMappingMode | null {
  if (context === "operatorPending") return null;
  return context ?? "all";
}

const targetKey = (target: VimMappingTarget) => `${target.mode}\u0000${target.keys}`;

/** The mappings in effect at the end of the file, in the order they were first mapped. */
export function vimrcMappings(text: string): readonly VimrcMappingRow[] {
  const rows = new Map<string, VimrcMappingRow>();
  for (const command of parseVimrc(text).commands) {
    if (command.kind === "set") continue;
    const mode = modeOf(command.context);
    if (mode === null) continue;
    const key = targetKey({ mode, keys: command.lhs });
    if (command.kind === "unmap") {
      rows.delete(key);
      continue;
    }
    rows.set(key, {
      mode,
      keys: command.lhs,
      does: command.rhs,
      recursive: !command.noremap,
      line: command.line,
    });
  }
  return [...rows.values()];
}

/** A mapping as a vimrc line: `inoremap jk <Esc>`. */
function formatVimrcMapping(mapping: VimMapping): string {
  const command = `${MODE_PREFIX[mapping.mode]}${mapping.recursive ? "map" : "noremap"}`;
  return `${command} ${mapping.keys} ${mapping.does}`;
}

/** A vimrc's lines, and how to join them back as the file had them. */
function splitLines(text: string) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  // A final newline leaves an empty last element; it comes back on join.
  const trailing = lines.at(-1) === "";
  if (trailing) lines.pop();
  return {
    lines,
    join: (next: readonly string[]) =>
      next.length === 0 ? "" : `${next.join(newline)}${trailing || text === "" ? newline : ""}`,
  };
}

/** Each line's map or unmap command, by 1-based line. */
function mappingLines(text: string) {
  const byLine = new Map<number, VimMappingTarget>();
  for (const command of parseVimrc(text).commands) {
    if (command.kind === "set") continue;
    const mode = modeOf(command.context);
    if (mode !== null) byLine.set(command.line, { mode, keys: command.lhs });
  }
  return byLine;
}

/**
 * Writes `mapping` into the vimrc in place of the line that maps its mode and keys (or
 * `replace`'s), else at the end. Other lines for either, maps or unmaps, go, so the mapping is
 * in effect once.
 */
export function upsertVimrcMapping(
  text: string,
  mapping: VimMapping,
  replace?: VimMappingTarget,
): string {
  const { lines, join } = splitLines(text);
  const targets = new Set([targetKey(mapping), ...(replace ? [targetKey(replace)] : [])]);
  const byLine = mappingLines(text);
  const formatted = formatVimrcMapping(mapping);
  let written = false;
  const next = lines.flatMap((raw, index) => {
    const target = byLine.get(index + 1);
    if (!target || !targets.has(targetKey(target))) return [raw];
    const isMap = Object.hasOwn(MAP_COMMANDS, lineSource(raw).split(/\s+/)[0] ?? "");
    if (written || !isMap) return [];
    written = true;
    return [formatted];
  });
  return join(written ? next : [...next, formatted]);
}

/** Removes every line that maps or unmaps `target`'s mode and keys. */
export function removeVimrcMapping(text: string, target: VimMappingTarget): string {
  const { lines, join } = splitLines(text);
  const byLine = mappingLines(text);
  const key = targetKey(target);
  return join(
    lines.filter((_, index) => {
      const found = byLine.get(index + 1);
      return !found || targetKey(found) !== key;
    }),
  );
}

/** The names `set` takes for each option Settings offers. */
const OPTION_NAMES: Readonly<Record<VimOptionName, readonly string[]>> = {
  pcre: ["pcre"],
  insertModeEscKeysTimeout: ["insertModeEscKeysTimeout"],
};

/** The defaults of the options Settings offers, as the Vim core defines them. */
export const VIM_OPTION_DEFAULT_VALUES = {
  pcre: true,
  insertModeEscKeysTimeout: 200,
} as const satisfies Record<VimOptionName, boolean | number>;

const optionNamed = (name: string) =>
  (Object.keys(OPTION_NAMES) as VimOptionName[]).find((option) =>
    OPTION_NAMES[option].includes(name),
  );

/** What the vimrc sets each option Settings offers to, by its last `set`; unset ones are absent. */
export function vimrcOptions(text: string): Partial<Record<VimOptionName, boolean | number>> {
  const values: Partial<Record<VimOptionName, boolean | number>> = {};
  for (const command of parseVimrc(text).commands) {
    if (command.kind !== "set") continue;
    const option = optionNamed(command.name);
    if (!option) continue;
    const current = values[option] ?? VIM_OPTION_DEFAULT_VALUES[option];
    const value = optionValue(current, command.value);
    if (typeof value === "boolean" || typeof value === "number") values[option] = value;
  }
  return values;
}

/** An option's value as a `set` line: `set nopcre`, `set textwidth=100`. */
function formatVimrcOption(name: VimOptionName, value: boolean | number) {
  return typeof value === "boolean" ? `set ${value ? "" : "no"}${name}` : `set ${name}=${value}`;
}

/** The option a `set` argument names, by any of its names. */
function argumentOption(argument: string) {
  return optionNamed(setArgument(argument).name);
}

/**
 * Sets an option in the vimrc, in place of the first `set` that names it, else at the end; a null
 * value removes it, back to its default. Other options on a shared `set` line stay on it.
 */
export function setVimrcOption(text: string, input: ServerSetVimOptionInput): string {
  const { lines, join } = splitLines(text);
  const { name, value } = input;
  let written = false;
  const next = lines.flatMap((raw) => {
    const [word = "", ...args] = lineSource(raw).split(/\s+/);
    if ((word !== "set" && word !== "se") || !args.some((arg) => argumentOption(arg) === name))
      return [raw];
    const kept = args.filter((arg) => argumentOption(arg) !== name);
    const replaced = kept.length > 0 ? [`${word} ${kept.join(" ")}`] : [];
    if (written || value === null) return replaced;
    written = true;
    return [...replaced, formatVimrcOption(name, value)];
  });
  if (value === null || written) return join(next);
  return join([...next, formatVimrcOption(name, value)]);
}
