import { type Extension, Facet } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";

/**
 * Astrolabe: Vim's normal-mode keys for language-server features (`K` hover, `gd` definition…).
 * Vim's keymap is global, so each key is mapped once to an action that runs what the editor it is
 * pressed in registered under that name, and does nothing in editors without one.
 */

export type LspVimAction =
  | "hover"
  | "definition"
  | "declaration"
  | "typeDefinition"
  | "implementation"
  | "references"
  | "incomingCalls"
  | "outgoingCalls"
  | "projectSymbols";

const VIM_KEYS: Readonly<Record<LspVimAction, string>> = {
  hover: "K",
  definition: "gd",
  declaration: "gD",
  typeDefinition: "gy",
  implementation: "gI",
  references: "gr",
  incomingCalls: "gh",
  outgoingCalls: "gH",
  projectSymbols: "gW",
};

const actions = Facet.define<Partial<Record<LspVimAction, Command>>>();

let defined = false;

function define() {
  if (defined) return;
  defined = true;
  for (const [name, keys] of Object.entries(VIM_KEYS)) {
    const action = `atlasLsp-${name}`;
    Vim.defineAction(action, (cm) => {
      const view: EditorView = cm.cm6;
      for (const registered of view.state.facet(actions)) {
        const run = registered[name as LspVimAction];
        // After Vim has finished with the key: a feature may move focus or open a picker.
        if (run) return void queueMicrotask(() => run(view));
      }
    });
    Vim.mapCommand(keys, "action", action, {}, { context: "normal" });
  }
}

/** Runs `commands` from their Vim keys in this editor. */
export function lspVimKeys(commands: Partial<Record<LspVimAction, Command>>): Extension {
  define();
  return actions.of(commands);
}
