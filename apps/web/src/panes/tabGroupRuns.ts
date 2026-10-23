/**
 * Astrolabe: a strip's tabs in runs, as tab groups show them (`tabGroups.tsx`), in a pane's strip
 * and in the chat tabs alike: neighbouring tabs of one change group stand together behind its
 * marker. A thread's chat can be in several groups: it joins the run before it when that run's
 * group is one of its own, else starts a run of the group it shares with the tab after it, else
 * of its first group.
 */
export interface TabRun<G> {
  /** The run's group; null for a tab in none. */
  readonly group: G | null;
  readonly keys: readonly string[];
}

/** `keys`, in strip order, as runs; `groupsOf` names each tab's groups, `idOf` tells them apart. */
export function tabGroupRuns<G>(
  keys: readonly string[],
  groupsOf: (key: string) => readonly G[],
  idOf: (group: G) => string,
): TabRun<G>[] {
  const runs: { group: G | null; keys: string[] }[] = [];
  keys.forEach((key, index) => {
    const groups = groupsOf(key);
    const last = runs.at(-1);
    const lastId = last?.group == null ? null : idOf(last.group);
    if (last && lastId !== null && groups.some((group) => idOf(group) === lastId)) {
      last.keys.push(key);
      return;
    }
    const next = keys[index + 1];
    const after = next === undefined ? [] : groupsOf(next).map(idOf);
    const group = groups.find((candidate) => after.includes(idOf(candidate))) ?? groups[0] ?? null;
    runs.push({ group, keys: [key] });
  });
  return runs;
}
