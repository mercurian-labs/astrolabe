import { LSPPlugin, type WorkspaceMapping } from "@codemirror/lsp-client";
import { type Extension, Facet } from "@codemirror/state";
import { type Command, EditorView, keymap, WidgetType } from "@codemirror/view";

import { lineBlocks, setLineBlocks } from "../blocks/lineBlocks.ts";

/**
 * Astrolabe: rename a symbol. The new name is typed in a box below the symbol's line; the
 * environment applies the server's edit to every file it names (open or not) and keeps its
 * inverse, so the host can offer one "Undo rename" (see docs/internals/language-servers.md).
 */

/** A place an applied edit changed: lines from 1, columns from 0. */
export interface EditPlace {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** What the environment did: its undo id, the files it changed, and how many edits. */
export interface RenameResult {
  readonly id: string;
  readonly files: readonly string[];
  readonly edits: number;
  /** The first of them, in the files as the edit left them. */
  readonly places: readonly EditPlace[];
  readonly from: string;
  readonly to: string;
}

export interface RenameHost {
  readonly renamed: (view: EditorView, result: RenameResult) => void;
}

const renameHost = Facet.define<RenameHost, RenameHost | null>({
  combine: (values) => values[0] ?? null,
});

interface LspPosition {
  readonly line: number;
  readonly character: number;
}
interface PrepareAnswer {
  readonly start?: LspPosition;
  readonly end?: LspPosition;
  readonly range?: { readonly start: LspPosition; readonly end: LspPosition };
  readonly placeholder?: string;
  readonly defaultBehavior?: boolean;
}

const OWNER = "rename";

class RenameBox extends WidgetType {
  constructor(
    readonly name: string,
    readonly finish: (value: string | null) => void,
  ) {
    super();
  }

  override eq(other: RenameBox) {
    return other === this;
  }

  override toDOM() {
    const dom = document.createElement("div");
    dom.className = "atlas-rename";
    const input = document.createElement("input");
    input.className = "atlas-rename-input";
    input.value = this.name;
    input.spellcheck = false;
    input.setAttribute("aria-label", `Rename ${this.name}`);
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      this.finish(value);
    };
    input.addEventListener("keydown", (event) => {
      // The box's keys are its own: not the editor's, Vim's or the app's.
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finish(input.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });
    input.addEventListener("blur", () => finish(null));
    const hint = document.createElement("span");
    hint.className = "atlas-rename-hint";
    hint.textContent = "Enter to rename everywhere, Escape to cancel";
    dom.append(input, hint);
    // In the document once the transaction that drew it is done.
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return dom;
  }

  override ignoreEvent() {
    return true;
  }
}

function close(view: EditorView, mapping: WorkspaceMapping) {
  mapping.destroy();
  view.dispatch({ effects: setLineBlocks(OWNER, []) });
  view.focus();
}

function submit(
  view: EditorView,
  plugin: LSPPlugin,
  mapping: WorkspaceMapping,
  start: LspPosition,
  oldName: string,
  newName: string | null,
) {
  const from = mapping.mapPosition(plugin.uri, start, 1);
  close(view, mapping);
  if (newName === null || newName.trim() === "" || newName === oldName) return;
  plugin.client.sync();
  plugin.client
    .request<object, { readonly applied?: Omit<RenameResult, "from" | "to"> } | null>(
      "textDocument/rename",
      { textDocument: { uri: plugin.uri }, position: plugin.toPosition(from), newName },
    )
    .then(
      (answer) => {
        if (!answer?.applied) return;
        // An older environment names no places.
        const { places = [] } = answer.applied;
        view.state
          .facet(renameHost)
          ?.renamed(view, { ...answer.applied, places, from: oldName, to: newName });
      },
      (error) => plugin.reportError("Rename failed", error),
    );
}

/** Opens the rename box for the symbol at the cursor, when the server can rename it. */
export const renameSymbol: Command = (view) => {
  const plugin = LSPPlugin.get(view);
  const provider = plugin?.client.serverCapabilities?.renameProvider;
  if (!plugin || view.state.readOnly || (plugin.client.serverCapabilities && !provider)) {
    return false;
  }
  plugin.client.sync();
  const mapping = plugin.client.workspaceMapping();
  const head = view.state.selection.main.head;
  const word = view.state.wordAt(head);
  const fallback = word
    ? { start: plugin.toPosition(word.from), end: plugin.toPosition(word.to) }
    : null;
  const prepared: Promise<PrepareAnswer | null | undefined> =
    typeof provider === "object" && provider.prepareProvider
      ? plugin.client.request("textDocument/prepareRename", {
          textDocument: { uri: plugin.uri },
          position: plugin.toPosition(head),
        })
      : Promise.resolve(undefined);
  prepared.then(
    (answer) => {
      const range =
        answer === undefined || answer?.defaultBehavior
          ? fallback
          : (answer?.range ??
            (answer?.start && answer.end ? { start: answer.start, end: answer.end } : null));
      if (!range) {
        mapping.destroy();
        return;
      }
      const from = mapping.mapPosition(plugin.uri, range.start, 1);
      const to = Math.max(from, mapping.mapPosition(plugin.uri, range.end, -1));
      const name = answer?.placeholder ?? view.state.sliceDoc(from, to);
      const box = new RenameBox(name, (value) =>
        submit(view, plugin, mapping, range.start, name, value),
      );
      view.dispatch({
        effects: setLineBlocks(OWNER, [
          { id: "box", placement: "below", from, widget: box, priority: 10 },
        ]),
      });
    },
    (error) => {
      mapping.destroy();
      plugin.reportError("Rename failed", error);
    },
  );
  return true;
};

const theme = EditorView.baseTheme({
  ".atlas-rename": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "2px 0 4px",
    fontFamily: "var(--atlas-md-font-ui, inherit)",
    fontSize: "12px",
  },
  ".atlas-rename-input": {
    font: "inherit",
    fontFamily: "var(--atlas-md-font-mono, monospace)",
    minWidth: "16em",
    padding: "1px 4px",
    border: "1px solid var(--atlas-md-focus-ring, currentColor)",
    borderRadius: "3px",
    background: "transparent",
    color: "inherit",
    outline: "none",
  },
  ".atlas-rename-hint": { opacity: "0.7" },
});

export function environmentRename(options: {
  readonly keys: readonly string[];
  readonly host: RenameHost;
}): Extension {
  return [
    renameHost.of(options.host),
    lineBlocks,
    keymap.of(options.keys.map((key) => ({ key, run: renameSymbol, preventDefault: true }))),
    theme,
  ];
}
