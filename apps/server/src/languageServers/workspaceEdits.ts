import { ChangeSet, type Text } from "@codemirror/state";

/** LSP workspace edits as change sets, per file. */

// LSP edits are untyped JSON; each reader checks the shape it reads.
type Json = any;

export interface TextEdit {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly newText: string;
}

/**
 * The text edits of a `WorkspaceEdit`, by file URI; null when it also creates, renames or deletes
 * files, which is not applied here.
 */
export const editsByFile = (edit: Json): Map<string, TextEdit[]> | null => {
  const files = new Map<string, TextEdit[]>();
  const add = (uri: unknown, edits: unknown) => {
    if (typeof uri !== "string" || !Array.isArray(edits)) return;
    files.set(uri, [...(files.get(uri) ?? []), ...edits]);
  };
  for (const change of Array.isArray(edit?.documentChanges) ? edit.documentChanges : []) {
    if (change?.kind !== undefined) return null;
    add(change?.textDocument?.uri, change?.edits);
  }
  if (!Array.isArray(edit?.documentChanges)) {
    for (const [uri, edits] of Object.entries(edit?.changes ?? {})) add(uri, edits);
  }
  return files;
};

const offsetOf = (text: Text, position: TextEdit["range"]["start"]) => {
  const line = text.line(Math.max(1, Math.min(position.line + 1, text.lines)));
  return Math.min(line.from + Math.max(0, position.character), line.to);
};

/** `edits` over `text` as one change set: duplicates once, overlapping ones dropped. */
export const changeSetOf = (text: Text, edits: ReadonlyArray<TextEdit>): ChangeSet => {
  const specs = edits
    .map((edit) => {
      const from = offsetOf(text, edit.range.start);
      return {
        from,
        to: Math.max(from, offsetOf(text, edit.range.end)),
        insert: String(edit.newText ?? ""),
      };
    })
    .toSorted((a, b) => a.from - b.from || a.to - b.to);
  const kept: typeof specs = [];
  for (const spec of specs) {
    const last = kept.at(-1);
    if (last && last.from === spec.from && last.to === spec.to && last.insert === spec.insert) {
      continue;
    }
    if (last && spec.from < last.to) continue;
    kept.push(spec);
  }
  return ChangeSet.of(kept, text.length);
};
