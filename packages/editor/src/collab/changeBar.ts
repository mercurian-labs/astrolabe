import type { Extension } from "@codemirror/state";
import { showPanel, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import {
  acceptTurn,
  agentTurns,
  nextAgentChange,
  previousAgentChange,
  revertTurn,
} from "./changeCommands.ts";
import { agentLog, agentLogField } from "./changeState.ts";

function countLabel(view: EditorView) {
  const count = agentLog(view.state)?.entries.length ?? 0;
  return count === 1 ? "1 agent change" : `${count} agent changes`;
}

function createBar(view: EditorView): Panel {
  const bar = document.createElement("div");
  bar.className = "atlas-agent-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Agent changes");

  const count = document.createElement("span");
  count.className = "atlas-agent-bar-count";
  count.setAttribute("aria-live", "polite");
  count.textContent = countLabel(view);
  bar.append(count);

  const button = (label: string, act: () => void) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "atlas-agent-bar-button";
    element.textContent = label;
    // Pressing a button keeps focus, and so the caret, in the editor.
    element.addEventListener("mousedown", (event) => event.preventDefault());
    element.addEventListener("click", act);
    bar.append(element);
  };
  const navigate = (move: (view: EditorView) => boolean) => () => {
    if (move(view)) view.focus();
  };
  button("Previous", navigate(previousAgentChange));
  button("Next", navigate(nextAgentChange));
  button("Accept all", () => {
    for (const turnId of agentTurns(view)) acceptTurn(view, turnId);
  });
  button("Revert all", () => {
    for (const turnId of agentTurns(view).toReversed()) revertTurn(view, turnId);
  });

  return {
    dom: bar,
    update(update: ViewUpdate) {
      if (agentLog(update.state) !== agentLog(update.startState)) {
        count.textContent = countLabel(update.view);
      }
    },
  };
}

/**
 * A bar along the bottom of the editor for reviewing agent changes: the count of entries, Previous and
 * Next, and Accept all and Revert all over every turn in the log. Hidden while the log is
 * empty. Needs `agentChanges` on the same view; a host can build its own chrome from the
 * same commands instead.
 */
export function agentChangeBar(): Extension {
  return [
    agentLogField,
    showPanel.compute([agentLogField], (state) =>
      state.field(agentLogField).entries.length > 0 ? createBar : null,
    ),
  ];
}
