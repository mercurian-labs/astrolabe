import {
  Facet,
  StateEffect,
  StateField,
  type ChangeDesc,
  type EditorState,
} from "@codemirror/state";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { readAgents } from "./agentAwareness.ts";
import { resolveAgentChanges, type AgentChange } from "./changeLog.ts";

/** The Yjs text and awareness a view's agent changes come from. */
export interface AgentChangesConfig {
  text: Y.Text;
  awareness: Awareness;
}

export const agentChangesConfig = Facet.define<AgentChangesConfig, AgentChangesConfig | null>({
  combine: (values) => values[0] ?? null,
});

/** The change log as the view shows it. */
export interface AgentLogState {
  /** Log order, oldest first, with positions in this view's document. */
  entries: readonly AgentChange[];
  /** Turn ids some agent presence carries; entries of any other turn are settled. */
  live: ReadonlySet<string>;
  /** Collapsed ghosts the user expanded, by `ghostKey`. */
  expanded: ReadonlySet<string>;
}

/** Replaces the entries, resolved against Yjs while the view is in sync with it. */
export const setAgentLog = StateEffect.define<readonly AgentChange[]>();
export const setLiveTurns = StateEffect.define<ReadonlySet<string>>();
export const expandGhost = StateEffect.define<string>();

const NO_ENTRIES: ReadonlySet<string> = new Set();

/**
 * Ids of entries that just arrived, whose ghosts draw with the arriving class so they can
 * fade in. `revealAgentChanges` provides it; without it, ghosts simply appear.
 */
export const arrivingEntries = Facet.define<ReadonlySet<string>, ReadonlySet<string>>({
  combine: (values) => values[0] ?? NO_ENTRIES,
});

export function ghostKey(id: string, opIndex: number) {
  return `${id}:${opIndex}`;
}

export function liveTurns(awareness: Awareness): Set<string> {
  const live = new Set<string>();
  for (const agent of readAgents(awareness).values()) live.add(agent.turnId);
  return live;
}

// Local edits map positions the way the relative positions resolve: an op's start (and a
// ghost's anchor) moves past text typed at it unless the op sticks to the character before
// it, and its end does not grow.
function mapEntries(entries: readonly AgentChange[], changes: ChangeDesc): AgentChange[] {
  return entries.map((entry) => ({
    ...entry,
    ops: entry.ops.map((op) => {
      const from = changes.mapPos(op.from, op.assoc);
      return { ...op, from, to: Math.max(from, changes.mapPos(op.to, -1)) };
    }),
  }));
}

function keepExpanded(expanded: ReadonlySet<string>, entries: readonly AgentChange[]) {
  if (expanded.size === 0) return expanded;
  const ids = new Set(entries.map((entry) => entry.id));
  return new Set([...expanded].filter((key) => ids.has(key.slice(0, key.lastIndexOf(":")))));
}

export const agentLogField = StateField.define<AgentLogState>({
  create(state) {
    const config = state.facet(agentChangesConfig);
    const doc = config?.text.doc;
    return {
      entries: config && doc ? resolveAgentChanges(doc, config.text, state.doc.length) : [],
      live: config ? liveTurns(config.awareness) : new Set(),
      expanded: new Set(),
    };
  },
  update(value, tr) {
    let next = value;
    if (tr.docChanged && next.entries.length > 0) {
      next = { ...next, entries: mapEntries(next.entries, tr.changes) };
    }
    for (const effect of tr.effects) {
      if (effect.is(setAgentLog)) {
        next = {
          ...next,
          entries: effect.value,
          expanded: keepExpanded(next.expanded, effect.value),
        };
      } else if (effect.is(setLiveTurns)) {
        next = { ...next, live: effect.value };
      } else if (effect.is(expandGhost)) {
        next = { ...next, expanded: new Set([...next.expanded, effect.value]) };
      }
    }
    return next;
  },
});

/** The view's change log, or `undefined` when `agentChanges` is not installed. */
export function agentLog(state: EditorState): AgentLogState | undefined {
  return state.field(agentLogField, false);
}
