import { ChangeSet, type ChangeDesc, type Text } from "@codemirror/state";

/**
 * Where LSP positions live in each method's params and answers, and how they move between the
 * browser's document and the environment's. Offsets are CodeMirror's, UTF-16 like LSP's.
 */

export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}

export const toPosition = (doc: Text, offset: number): Position => {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
};

const fromPosition = (doc: Text, position: Position): number => {
  const line = doc.line(Math.max(1, Math.min(position.line + 1, doc.lines)));
  return Math.min(line.from + Math.max(0, position.character), line.to);
};

/** An edit in an answer that cannot be expressed in the requester's document. */
export class Unrepresentable extends Error {}

export interface OffsetMapper {
  readonly from: Text;
  readonly to: Text;
  readonly point: (offset: number, assoc: number) => number;
  /** False when the range touches text the target document doesn't have. */
  readonly rangeSafe: (from: number, to: number) => boolean;
}

export const forwardMapper = (from: Text, to: Text, changes: ChangeDesc): OffsetMapper => ({
  from,
  to,
  point: (offset, assoc) => changes.mapPos(offset, assoc),
  rangeSafe: () => true,
});

/**
 * Maps back through `changes`, which take `to` into `from`. Text they inserted has no counterpart
 * in `to`: points inside it are clamped to its edge, and edits touching it are unsafe.
 */
export const inverseMapper = (from: Text, to: Text, changes: ChangeDesc): OffsetMapper => {
  const inverse = changes.invertedDesc;
  const regions: Array<readonly [number, number]> = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => regions.push([fromB, toB]));
  return {
    from,
    to,
    point: (offset, assoc) => inverse.mapPos(offset, assoc),
    rangeSafe: (start, end) =>
      !regions.some(([a, b]) => (b > a ? a < end && b > start : start < a && a < end)),
  };
};

/**
 * The change set a browser whose confirmed text is at the start of `since`, holding
 * `unconfirmed`, will apply to reach the environment's text: everyone else's updates, with the
 * browser's own (already in its text) mapped out. This is what collab's `receiveUpdates` does.
 */
export const browserToAuthority = (
  since: ReadonlyArray<{ readonly clientID: string; readonly changes: ChangeSet }>,
  clientID: string,
  unconfirmed: ReadonlyArray<ChangeSet>,
  browserLength: number,
): ChangeSet => {
  let changes: ChangeSet | null = null;
  let own = 0;
  for (const update of since) {
    if (own < unconfirmed.length && update.clientID === clientID) {
      if (changes) changes = changes.map(unconfirmed[own]!, true);
      own++;
    } else {
      changes = changes ? changes.compose(update.changes) : update.changes;
    }
  }
  if (own < unconfirmed.length) throw new Unrepresentable("unconfirmed updates are not landed");
  return changes ?? ChangeSet.empty(browserLength);
};

const mapPoint = (m: OffsetMapper, position: Position, assoc: number): Position =>
  toPosition(m.to, m.point(fromPosition(m.from, position), assoc));

const mapRange = (m: OffsetMapper, range: Range, strict: boolean): Range => {
  const start = fromPosition(m.from, range.start);
  const end = fromPosition(m.from, range.end);
  if (strict && !m.rangeSafe(start, end)) throw new Unrepresentable(`range ${start}-${end}`);
  const mappedStart = m.point(start, start === end ? -1 : 1);
  const mappedEnd = Math.max(mappedStart, m.point(end, -1));
  return { start: toPosition(m.to, mappedStart), end: toPosition(m.to, mappedEnd) };
};

// LSP answers are untyped JSON here: each branch checks the shape it reads.
type Json = any;

/** `strict`: an edit applied verbatim, so it must not touch text the target lacks. */
const mapEdit = (m: OffsetMapper, edit: Json, strict: boolean) => {
  if (edit.range) edit.range = mapRange(m, edit.range, strict);
  if (edit.insert) edit.insert = mapRange(m, edit.insert, strict);
  if (edit.replace) edit.replace = mapRange(m, edit.replace, strict);
};

/** Request params: positions the client computed in its document. Mutates and returns them. */
export const mapParams = (params: Json, m: OffsetMapper): Json => {
  if (params?.position) params.position = mapPoint(m, params.position, -1);
  if (params?.range) params.range = mapRange(m, params.range, false);
  // A completion item handed back to resolve it carries its edit in the editor's text.
  if (params?.textEdit) mapEdit(m, params.textEdit, false);
  return params;
};

const LOCATION_METHODS = new Set([
  "textDocument/definition",
  "textDocument/declaration",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/references",
]);

/** Answer positions in the document `uri` the mapper describes; throws `Unrepresentable`. */
export const mapResult = (method: string, result: Json, uri: string, m: OffsetMapper): Json => {
  if (result == null) return result;
  switch (method) {
    case "textDocument/completion": {
      const list = Array.isArray(result) ? { items: result } : result;
      // The word being completed: autocomplete re-derives and maps it, so clamping is right.
      const defaults = list.itemDefaults?.editRange;
      if (defaults) {
        if ("insert" in defaults) mapEdit(m, defaults, false);
        else list.itemDefaults.editRange = mapRange(m, defaults, false);
      }
      for (const item of list.items ?? []) {
        if (item.textEdit) mapEdit(m, item.textEdit, false);
        for (const edit of item.additionalTextEdits ?? []) mapEdit(m, edit, true);
      }
      return result;
    }
    case "completionItem/resolve":
      if (result.textEdit) mapEdit(m, result.textEdit, false);
      for (const edit of result.additionalTextEdits ?? []) mapEdit(m, edit, true);
      return result;
    case "textDocument/hover":
      if (result.range) result.range = mapRange(m, result.range, false);
      return result;
    case "textDocument/rename":
      for (const edit of result.changes?.[uri] ?? []) mapEdit(m, edit, true);
      for (const change of result.documentChanges ?? []) {
        if (change.textDocument?.uri !== uri) continue;
        change.textDocument.version = null;
        for (const edit of change.edits ?? []) mapEdit(m, edit, true);
      }
      return result;
    case "textDocument/formatting":
    case "textDocument/rangeFormatting":
      for (const edit of Array.isArray(result) ? result : []) mapEdit(m, edit, true);
      return result;
    case "textDocument/prepareRename":
      if (result.start) return mapRange(m, result, false);
      if (result.range) result.range = mapRange(m, result.range, false);
      return result;
  }
  if (LOCATION_METHODS.has(method)) {
    for (const location of Array.isArray(result) ? result : [result]) {
      if (location.uri === uri && location.range) {
        location.range = mapRange(m, location.range, false);
      }
      if (location.targetUri === uri) {
        location.targetRange = mapRange(m, location.targetRange, false);
        location.targetSelectionRange = mapRange(m, location.targetSelectionRange, false);
      }
      if (location.originSelectionRange) {
        location.originSelectionRange = mapRange(m, location.originSelectionRange, false);
      }
    }
  }
  return result;
};

/** Diagnostics positions, from the document they were computed on into another. */
export const mapDiagnostics = (diagnostics: Json, m: OffsetMapper): Json => {
  for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
    if (diagnostic?.range) diagnostic.range = mapRange(m, diagnostic.range, false);
  }
  return diagnostics;
};

const COMPLETION_MAX_ITEMS = 200;

/** Whether `query`'s characters appear in `text` in order, ignoring case. */
const subsequence = (query: string, text: string) => {
  let at = 0;
  for (const char of text.toLowerCase()) if (char === query[at]) at++;
  return at === query.length;
};

/**
 * Completion lists can run to thousands of items and megabytes. Keep the items the word being
 * typed (`query`) can still match, the best-sorted few of them, without documentation (resolve
 * fetches it); a list cut short says it is incomplete, so the editor asks again as you type.
 */
export const trimCompletion = (result: Json, query = ""): Json => {
  if (result == null) return result;
  const list = Array.isArray(result) ? { isIncomplete: false, items: result } : result;
  if (!Array.isArray(list.items)) return result;
  const lowered = query.toLowerCase();
  const items = lowered
    ? list.items.filter((item: Json) => subsequence(lowered, String(item.filterText ?? item.label)))
    : list.items;
  for (const item of items) delete item.documentation;
  if (items.length > COMPLETION_MAX_ITEMS) {
    const key = (item: Json) => String(item.sortText ?? item.label ?? "");
    list.items = items
      .toSorted((a: Json, b: Json) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
      .slice(0, COMPLETION_MAX_ITEMS);
    list.isIncomplete = true;
  } else {
    list.items = items;
  }
  return list;
};

/** The identifier characters before `position`: what a completion there is matched against. */
export const wordBefore = (doc: Text, position: Position): string => {
  const offset = fromPosition(doc, position);
  const line = doc.lineAt(offset);
  return /[\w$]*$/.exec(line.text.slice(0, offset - line.from))![0];
};

const HOVER_MAX_LENGTH = 100_000;

/** `text` cut to `length` characters, closing a code fence the cut leaves open. */
const cutMarkdown = (text: string, length: number) => {
  if (text.length <= length) return text;
  const kept = text.slice(0, length);
  const fences = kept.match(/^```/gm)?.length ?? 0;
  return `${kept}${fences % 2 === 1 ? "\n```" : ""}\n…`;
};

/** A hover's text kept within 100 000 characters across its parts; later parts are dropped. */
export const trimHover = (result: Json): Json => {
  if (result == null) return result;
  const contents = result.contents;
  if (typeof contents === "string") result.contents = cutMarkdown(contents, HOVER_MAX_LENGTH);
  else if (typeof contents?.value === "string") {
    contents.value = cutMarkdown(contents.value, HOVER_MAX_LENGTH);
  } else if (Array.isArray(contents)) {
    let left = HOVER_MAX_LENGTH;
    result.contents = contents.flatMap((part: Json) => {
      if (left <= 0) return [];
      const value = typeof part === "string" ? part : String(part?.value ?? "");
      const kept = cutMarkdown(value, left);
      left -= value.length;
      return [typeof part === "string" ? kept : { ...part, value: kept }];
    });
  }
  return result;
};
