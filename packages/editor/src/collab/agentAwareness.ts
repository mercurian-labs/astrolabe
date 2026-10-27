import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

/** An agent peer as it declares itself in awareness. */
export interface AgentPresence {
  name: string;
  color: string;
  turnId: string;
}

// Colours reach style attributes, and awareness states come from remote peers, so only
// six-digit hex colours are accepted; that also keeps `${color}33` a valid translucent tint.
const HEX_COLOR = /^#[\da-f]{6}$/i;
const FALLBACK_COLOR = "#d97706";

export function safeAgentColor(color: unknown): string {
  return typeof color === "string" && HEX_COLOR.test(color) ? color : FALLBACK_COLOR;
}

/**
 * Marks this awareness as an agent: `yCollab` reads `user` for the named cursor, `readAgents` reads
 * `agent` to attribute text. Bind `awareness` to the `Y.Doc` the agent writes with (attribution
 * matches client ids) and declare before its first write reaches peers; earlier text is never marked.
 */
export function declareAgent(awareness: Awareness, presence: AgentPresence): void {
  const color = safeAgentColor(presence.color);
  awareness.setLocalState({
    user: { name: presence.name, color, colorLight: `${color}33` },
    agent: { turnId: presence.turnId },
  });
}

/**
 * Ends the agent's turn: its presence drops the turn id, so editors settle that turn's
 * changes and stop attributing its writes. The named cursor stays until the peer leaves.
 */
export function endAgentTurn(awareness: Awareness): void {
  awareness.setLocalStateField("agent", null);
}

/** Agent presences in `awareness`, keyed by the Yjs client id each agent writes with. */
export function readAgents(awareness: Awareness): Map<number, AgentPresence> {
  const agents = new Map<number, AgentPresence>();
  awareness.getStates().forEach((state, clientId) => {
    const agent: unknown = state.agent;
    const user: unknown = state.user;
    if (!isRecord(agent) || typeof agent.turnId !== "string") return;
    const name = isRecord(user) && typeof user.name === "string" ? user.name : "Agent";
    const color = safeAgentColor(isRecord(user) ? user.color : undefined);
    agents.set(clientId, { name, color, turnId: agent.turnId });
  });
  return agents;
}

/**
 * Parks the agent's cursor at `index` in `text`. Remote editors render it through
 * `yCollab`'s remote selections; call it with the end of the agent's last insertion.
 */
export function parkAgentCursor(awareness: Awareness, text: Y.Text, index: number): void {
  const position = Y.createRelativePositionFromTypeIndex(text, index);
  awareness.setLocalStateField("cursor", { anchor: position, head: position });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
