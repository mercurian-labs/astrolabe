import type { Range } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { oldTextInline } from "../blocks/oldText.ts";
import { dismissAgentDeletion, restoreAgentDeletion } from "./changeCommands.ts";
import { expandGhost, ghostKey, type AgentLogState } from "./changeState.ts";

/**
 * One ghost per op that deleted text: the deleted text in place, struck through in the agent's
 * colour, with Restore and Dismiss. Ghosts of `arriving` entries fade in.
 */
export function ghostDecorations(
  log: AgentLogState | undefined,
  arriving: ReadonlySet<string>,
): DecorationSet {
  if (!log || log.entries.length === 0) return Decoration.none;
  const ghosts: Range<Decoration>[] = [];
  for (const entry of log.entries) {
    const settled = !log.live.has(entry.turnId);
    for (const [opIndex, op] of entry.ops.entries()) {
      if (op.deleted === "" || op.dismissed) continue;
      const key = ghostKey(entry.id, opIndex);
      const ghost = oldTextInline(
        {
          key,
          text: op.deleted,
          tint: entry.color,
          className: settled ? "atlas-agent-ghost atlas-agent-change-settled" : "atlas-agent-ghost",
          settled,
          arriving: arriving.has(entry.id),
          expanded: log.expanded.has(key),
          expand: (view) => view.dispatch({ effects: expandGhost.of(key) }),
          actions: [
            { label: "Restore", run: (view) => restoreAgentDeletion(view, entry.id, opIndex) },
            { label: "Dismiss", run: (view) => dismissAgentDeletion(view, entry.id, opIndex) },
          ],
        },
        op.from,
        // The ghost sits on the side its anchor sticks to.
        op.assoc,
      );
      ghosts.push(ghost);
    }
  }
  return Decoration.set(ghosts, true);
}
