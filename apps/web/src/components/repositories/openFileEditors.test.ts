import { history, undo } from "@codemirror/commands";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { EnvironmentId } from "@t3tools/contracts";
import { replacementsIn, textMatcher } from "@t3tools/shared/textReplace";
import { describe, expect, it } from "vite-plus/test";

import {
  editInOpenEditor,
  fileEditorChanged,
  openFileEditor,
  registerFileEditor,
} from "./openFileEditors";

const environmentId = EnvironmentId.make("open-file-editors");

/** A file's editor as `RepositoryFileView` has it: with undo, reporting each change. */
function openEditor(path: string, text: string) {
  const view = {
    state: EditorState.create({ doc: text, extensions: history() }),
    dispatch(spec: Transaction | TransactionSpec) {
      const tr = spec instanceof Transaction ? spec : view.state.update(spec);
      view.state = tr.state;
      if (tr.docChanged) fileEditorChanged(view as unknown as EditorView, tr.changes);
    },
  };
  const unregister = registerFileEditor({
    environmentId,
    cwd: "/repo",
    path,
    view: view as unknown as EditorView,
    writable: () => true,
    save: async () => true,
  });
  const replace = () => {
    const found = replacementsIn(
      view.state.doc.toString(),
      textMatcher({ query: "walkToken", caseSensitive: false, wholeWord: false, useRegex: false }),
      "renamed",
    );
    return editInOpenEditor(
      openFileEditor(environmentId, "/repo", path)!,
      found,
      "input.replace.all",
    );
  };
  return { view, unregister, replace, text: () => view.state.doc.toString() };
}

describe("editInOpenEditor", () => {
  it("leaves a file whose replacement its own editor already took back", () => {
    const file = openEditor("r1.ts", 'const a = "walkToken";\nuse("walkToken");');
    const edit = file.replace();
    expect(file.text()).toBe('const a = "renamed";\nuse("renamed");');
    undo(file.view);
    expect(file.text()).toBe('const a = "walkToken";\nuse("walkToken");');

    expect(edit.undo()).toBe(false);
    expect(file.text()).toBe('const a = "walkToken";\nuse("walkToken");');
    file.unregister();
  });

  it("takes back the replacements left as they were, over what was typed since", () => {
    const file = openEditor("r2.ts", 'const a = "walkToken";\nuse("walkToken");');
    const edit = file.replace();
    file.view.dispatch({ changes: { from: 0, insert: "// top\n" } });
    const second = file.text().lastIndexOf("renamed");
    file.view.dispatch({
      changes: { from: second, to: second + "renamed".length, insert: "mine" },
    });

    expect(edit.undo()).toBe(true);
    expect(file.text()).toBe('// top\nconst a = "walkToken";\nuse("mine");');
    file.unregister();
  });
});
