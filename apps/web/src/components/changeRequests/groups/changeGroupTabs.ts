import { EnvironmentId } from "@t3tools/contracts";

/**
 * Astrolabe: a change group's tab key, `change-group:<environment>:<group>`, which any section's
 * panes can hold. The group is the thread it started from.
 */
const PREFIX = "change-group:";

export interface ChangeGroupTab {
  readonly environmentId: EnvironmentId;
  readonly groupId: string;
}

export function changeGroupTabKey(tab: ChangeGroupTab): string {
  return `${PREFIX}${encodeURIComponent(tab.environmentId)}:${encodeURIComponent(tab.groupId)}`;
}

export function parseChangeGroupTabKey(key: string): ChangeGroupTab | null {
  if (!key.startsWith(PREFIX)) return null;
  const parts = key.slice(PREFIX.length).split(":");
  if (parts.length !== 2) return null;
  try {
    const [environmentId, groupId] = parts.map(decodeURIComponent);
    if (!environmentId || !groupId) return null;
    return { environmentId: EnvironmentId.make(environmentId), groupId };
  } catch {
    return null;
  }
}
