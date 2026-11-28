import type { IssueListEntry } from "@t3tools/contracts";

import { workspace } from "~/panes/workspace";
import type { Side } from "~/panes/tree";
import type { RowClickIntent } from "~/tabNavigation.logic";
import { issueTabKey, type IssueTabTarget } from "./issueTabs";

/**
 * Astrolabe: Issues opens its issues as tabs of the shared panes, as Projects and Changes do.
 */

const SEED_LIMIT = 50;
const seeds = new Map<string, IssueListEntry>();

/** The list row an issue's tab was opened from, shown until its detail arrives. */
export function issueTabSeed(tabKey: string): IssueListEntry | null {
  return seeds.get(tabKey) ?? null;
}

function remember(key: string, seed: IssueListEntry | undefined) {
  if (seed === undefined) return;
  seeds.delete(key);
  seeds.set(key, seed);
  if (seeds.size > SEED_LIMIT) seeds.delete(seeds.keys().next().value!);
}

/**
 * Shows an issue as a sidebar row's click asks: in the focused pane's tab in front (`replace`,
 * which remembers what it showed), else a new tab; one open already comes to the front.
 */
export function showIssue(target: IssueTabTarget, intent: RowClickIntent, seed?: IssueListEntry) {
  const key = issueTabKey(target);
  remember(key, seed);
  if (intent === "replace") workspace.show(key);
  else workspace.open(key);
}

/** Opens an issue dragged from the sidebar where it lands on `paneId`. */
export function placeIssue(
  target: IssueTabTarget,
  paneId: string,
  drop: { readonly side: Side | null; readonly index: number },
  seed?: IssueListEntry,
) {
  const key = issueTabKey(target);
  remember(key, seed);
  workspace.place([key], key, paneId, drop);
}
