/**
 * Astrolabe: project search's matching rules applied to a text in memory, and replace-all built on
 * them. Matches never span lines, as project search's never do; a replacement can still insert
 * line breaks. The browser and the environment both run this, so open and unopened files are
 * replaced alike.
 */

export interface TextQuery {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly useRegex: boolean;
}

export interface TextMatcher {
  readonly regex: RegExp;
  readonly wholeWord: boolean;
  readonly useRegex: boolean;
  /** Set when the regular expression is invalid; nothing matches then. */
  readonly error: string | null;
}

export interface TextReplacement {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;
const WORD_CHARACTER = /[\p{Letter}\p{Mark}\p{Number}_]/u;

export function textMatcher(query: TextQuery): TextMatcher {
  const flags = query.caseSensitive ? "gu" : "giu";
  const base = { wholeWord: query.wholeWord, useRegex: query.useRegex };
  if (!query.useRegex) {
    return {
      ...base,
      regex: new RegExp(query.query.replace(REGEX_SYNTAX, "\\$&"), flags),
      error: null,
    };
  }
  try {
    return { ...base, regex: new RegExp(query.query, flags), error: null };
  } catch (error) {
    return {
      ...base,
      regex: /(?!)/g,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const codePointAt = (line: string, index: number) => {
  const codePoint = line.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
};

const codePointBefore = (line: string, index: number) => {
  if (index <= 0) return undefined;
  const unit = line.charCodeAt(index - 1);
  return codePointAt(line, unit >= 0xdc00 && unit <= 0xdfff ? index - 2 : index - 1);
};

/** The same rule as project search's: no word character continues the match on either side. */
export function isWholeWord(line: string, start: number, end: number): boolean {
  if (end <= start) return false;
  const isWord = (character: string | undefined) =>
    character !== undefined && WORD_CHARACTER.test(character);
  const left =
    start === 0 || !isWord(codePointBefore(line, start)) || !isWord(codePointAt(line, start));
  const right =
    end >= line.length || !isWord(codePointAt(line, end)) || !isWord(codePointBefore(line, end));
  return left && right;
}

/** Each match in one line, as the regular expression found it. */
export function lineMatches(line: string, matcher: TextMatcher): RegExpExecArray[] {
  const { regex } = matcher;
  const found: RegExpExecArray[] = [];
  regex.lastIndex = 0;
  for (let match = regex.exec(line); match !== null; match = regex.exec(line)) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    if (!matcher.wholeWord || isWholeWord(line, match.index, match.index + match[0].length)) {
      found.push(match);
    }
  }
  return found;
}

/**
 * A regular expression's replacement for one match: `$&`, `$1`…`$99`, `$<name>` and `$$`, plus
 * `\n`, `\t` and `\\`. A plain-text search's replacement is used as written.
 */
function expandReplacement(template: string, match: RegExpExecArray, useRegex: boolean): string {
  if (!useRegex) return template;
  return template.replace(
    /\$(\$|&|<([^>]+)>|(\d{1,2}))|\\([nt\\])/g,
    (whole, _d, name, digits, escape) => {
      if (escape !== undefined) return escape === "n" ? "\n" : escape === "t" ? "\t" : "\\";
      if (whole === "$$") return "$";
      if (whole === "$&") return match[0];
      if (name !== undefined) return match.groups?.[name] ?? "";
      let index = Number(digits);
      // `$12` with one group reads as group 1, then "2".
      if (index >= match.length && digits.length === 2) {
        index = Number(digits[0]);
        return index < match.length ? (match[index] ?? "") + digits[1] : whole;
      }
      return index > 0 && index < match.length ? (match[index] ?? "") : whole;
    },
  );
}

/** Every replacement in `text`, in order, as positions into `text`. */
export function replacementsIn(
  text: string,
  matcher: TextMatcher,
  replacement: string,
): TextReplacement[] {
  const replacements: TextReplacement[] = [];
  if (matcher.error !== null) return replacements;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const end = text.indexOf("\n", lineStart);
    const lineEnd = end === -1 ? text.length : end;
    const line = text.slice(lineStart, lineEnd);
    for (const match of lineMatches(line, matcher)) {
      const insert = expandReplacement(replacement, match, matcher.useRegex);
      const from = lineStart + match.index;
      const to = from + match[0].length;
      if (text.slice(from, to) !== insert) replacements.push({ from, to, insert });
    }
    if (end === -1) break;
    lineStart = end + 1;
  }
  return replacements;
}

/** A replacement as made: where its text now is, that text, and the text it replaced. */
export interface MadeReplacement {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly original: string;
}

/** `replacements` of `text` (as `replacementsIn` gives them) as they sit in the replaced text. */
export function madeReplacements(
  text: string,
  replacements: readonly TextReplacement[],
): MadeReplacement[] {
  let shift = 0;
  return replacements.map((replacement) => {
    const from = replacement.from + shift;
    shift += replacement.insert.length - (replacement.to - replacement.from);
    return {
      from,
      to: from + replacement.insert.length,
      text: replacement.insert,
      original: text.slice(replacement.from, replacement.to),
    };
  });
}

/**
 * The edits that take `made` back in `current`, a later text, with `mapPos` mapping a position of
 * the replaced text into it (CodeMirror's `ChangeDesc.mapPos` over the edits since). A replacement
 * whose text was edited, removed or already put back since is left as it is, and counted.
 */
export function undoReplacements(
  made: readonly MadeReplacement[],
  current: { readonly sliceString: (from: number, to: number) => string },
  mapPos: (pos: number, assoc: -1 | 1) => number,
): { readonly changes: TextReplacement[]; readonly skipped: number } {
  const changes: TextReplacement[] = [];
  let skipped = 0;
  for (const replacement of made) {
    const from = mapPos(replacement.from, 1);
    const to = mapPos(replacement.to, -1);
    if (
      to - from !== replacement.text.length ||
      current.sliceString(from, to) !== replacement.text
    ) {
      skipped += 1;
      continue;
    }
    changes.push({ from, to, insert: replacement.original });
  }
  return { changes, skipped };
}
