import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { NavigateFn } from "@tanstack/react-router";

import { focusedPane, openTab } from "~/panes/arrangement";
import type { PaneArrangementStore } from "~/panes/panesHost";
import { repositoryPanes } from "../repositoryPanes";
import { repositoryCheckout, repositoryScope } from "../repositoryScope";
import { parseRepositoryTabKey, repositoryTabKey, type RepositorySearch } from "../repositoryTabs";

/**
 * Astrolabe: ways into a multi-file view (stacked excerpt editors) in the Repositories area: a
 * project search's results, a checkout's problems, or any list of places in its files.
 */

export interface MultibufferCheckout {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  /** The thread's working tree the checkout is, or null for the repository's own. */
  readonly worktreePath: string | null;
}

/** A place in a file: 1-based lines, 0-based columns; the end defaults to the start. */
export interface MultibufferLocation {
  readonly path: string;
  readonly line: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

export interface LocationList {
  readonly title: string;
  readonly locations: readonly MultibufferLocation[];
}

// Lists live as long as the page: a locations tab restored after a reload says they are gone.
const lists = new Map<string, LocationList>();
let nextList = 1;

export function locationList(id: string): LocationList | null {
  return lists.get(id) ?? null;
}

/** Keeps a list for a locations tab to show, under a new id. */
export function rememberLocationList(list: LocationList): string {
  const id = `l${nextList++}`;
  lists.set(id, list);
  return id;
}

function show(checkout: MultibufferCheckout, key: string, navigate: NavigateFn | null) {
  repositoryScope.set(`${checkout.environmentId}:${checkout.projectId}`);
  repositoryCheckout.set(checkout.worktreePath);
  repositoryPanes.show(key);
  if (navigate !== null) void navigate({ to: "/repositories" });
}

/** Opens a project search's results as one editor of excerpts with context. */
export function openSearchResults(
  checkout: MultibufferCheckout,
  search: RepositorySearch,
  navigate: NavigateFn | null,
) {
  const { environmentId, projectId, cwd } = checkout;
  show(
    checkout,
    repositoryTabKey({ kind: "search", environmentId, projectId, cwd, search }),
    navigate,
  );
}

/** A new locations tab's key, for these places in the checkout; each call names a new list. */
export function locationsTabKey(
  checkout: Pick<MultibufferCheckout, "environmentId" | "projectId" | "cwd">,
  list: LocationList,
): string {
  const id = rememberLocationList(list);
  const { environmentId, projectId, cwd } = checkout;
  return repositoryTabKey({ kind: "locations", environmentId, projectId, cwd, id });
}

/**
 * Opens these places (references, definitions, anything with a file and a line) as one editor
 * of excerpts with context, titled `title`, in the Repositories area. A new call opens a new
 * tab. A file's own references open beside it instead (`locationsTabKey`).
 * @public
 */
export function openLocationsInMultibuffer(
  checkout: MultibufferCheckout,
  list: LocationList,
  navigate: NavigateFn | null,
): string {
  const key = locationsTabKey(checkout, list);
  show(checkout, key, navigate);
  return key;
}

/** Opens a checkout's problems view in the panes `panes`, for the repository tab in front. */
export function problemsOpener(panes: PaneArrangementStore | null): (() => void) | null {
  const arrangement = panes?.getSnapshot()?.arrangement;
  if (panes === null || arrangement === undefined) return null;
  const tab = parseRepositoryTabKey(focusedPane(arrangement).active);
  if (tab === null) return null;
  const { environmentId, projectId, cwd } = tab;
  const key = repositoryTabKey({ kind: "problems", environmentId, projectId, cwd });
  return () => panes.update((next) => openTab(next, key));
}
