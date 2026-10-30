import { textMatcher, replacementsIn, type TextQuery } from "@t3tools/shared/textReplace";
import { DOCUMENT_REPLACE_ALL_MAX_FILES, type EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";

import { documentsEnvironment } from "~/state/documents";
import { editInOpenEditor, openFileEditor } from "../openFileEditors";

/**
 * Astrolabe: replace-all over a search's files (decision D13). A file open in an editor here takes
 * the replacement through that editor, where Mod-z undoes it; every other file is edited by the
 * environment under this view's client id, saved, and kept undoable there. One "Undo replace-all"
 * takes both back, over whatever was typed since.
 */

export interface ReplaceAllDone {
  readonly files: number;
  readonly replacements: number;
  readonly failed: ReadonlyArray<{ readonly relativePath: string; readonly message: string }>;
  readonly undo: () => Promise<string | null>;
}

export async function replaceAll(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly clientId: string;
  readonly query: TextQuery;
  readonly replacement: string;
  readonly paths: readonly string[];
}): Promise<
  | { readonly ok: true; readonly done: ReplaceAllDone }
  | { readonly ok: false; readonly message: string }
> {
  const { registry, environmentId, cwd } = options;
  const matcher = textMatcher(options.query);
  if (matcher.error !== null)
    return { ok: false, message: "The search is not a valid regular expression." };
  if (options.paths.length > DOCUMENT_REPLACE_ALL_MAX_FILES) {
    return {
      ok: false,
      message: `Replace-all covers up to ${DOCUMENT_REPLACE_ALL_MAX_FILES.toLocaleString()} files; narrow the search.`,
    };
  }
  const inEditors: Array<ReturnType<typeof editInOpenEditor>> = [];
  const elsewhere: string[] = [];
  let replacements = 0;
  for (const path of options.paths) {
    const editor = openFileEditor(environmentId, cwd, path);
    if (editor === null) {
      elsewhere.push(path);
      continue;
    }
    const changes = replacementsIn(editor.view.state.doc.toString(), matcher, options.replacement);
    if (changes.length === 0) continue;
    inEditors.push(editInOpenEditor(editor, changes, "input.replace.all"));
    replacements += changes.length;
  }
  let serverId: string | undefined;
  let files = inEditors.length;
  let failed: ReplaceAllDone["failed"] = [];
  if (elsewhere.length > 0) {
    const result = await documentsEnvironment.replaceAll.run(registry, {
      environmentId,
      input: {
        cwd,
        clientId: options.clientId,
        ...options.query,
        replacement: options.replacement,
        paths: elsewhere,
      },
    });
    if (!AsyncResult.isSuccess(result)) {
      for (const edit of inEditors) edit.undo();
      return { ok: false, message: "Replacing in the files that are not open failed." };
    }
    serverId = result.value.id;
    files += result.value.files;
    replacements += result.value.replacements;
    failed = result.value.failed;
  }
  return {
    ok: true,
    done: {
      files,
      replacements,
      failed,
      undo: async () => {
        let skipped = 0;
        for (const edit of inEditors) if (!edit.undo()) skipped += 1;
        if (serverId !== undefined) {
          const result = await documentsEnvironment.undoReplaceAll.run(registry, {
            environmentId,
            input: { cwd, id: serverId },
          });
          if (!AsyncResult.isSuccess(result)) {
            return "The files that were not open could not be changed back: the undo has expired.";
          }
          skipped += result.value.skipped.length;
        }
        return skipped === 0
          ? null
          : `${skipped} file${skipped === 1 ? " was" : "s were"} closed since and kept the replacement.`;
      },
    },
  };
}
