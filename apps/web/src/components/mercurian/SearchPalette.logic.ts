import * as Arr from "effect/Array";
import * as Result from "effect/Result";

import {
  normalizeSearchText,
  rankCommandPaletteItemMatch,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
} from "../CommandPalette.logic";
import {
  resolvePlanRowStatus,
  sortPlansNewestFirst,
  type PlanRowStatusFields,
} from "./planListing.logic";

/** About a dozen rows, matching the fork's recents limit. */
export const EMPTY_QUERY_PLAN_LIMIT = 12;

/** The two workspace rows the tree navigates to. Dashboard and Concepts are gone by design. */
export type SearchPaletteSection = "repositories" | "settings";

/** What the palette can start. Everything else it does is navigation. */
export type SearchPaletteAction = "new-plan" | "new-project" | "open-settings";

/**
 * Everything the palette can put in front of you, by what picking it means.
 *
 * A discriminated union rather than one flattened row shape because the kinds
 * do not navigate alike: a plan opens, a project resolves to a plan first, a
 * section is a page, an action runs. Coding-session results join as their own
 * arm when they arrive, touching none of these.
 */
export type SearchPaletteResult<TPlan, TProject> =
  | { readonly kind: "plan"; readonly plan: TPlan; readonly projectName: string }
  | { readonly kind: "project"; readonly project: TProject }
  | { readonly kind: "section"; readonly section: SearchPaletteSection }
  | { readonly kind: "action"; readonly action: SearchPaletteAction };

/**
 * The empty query's answer to "where am I needed, where was I".
 *
 * Needing-you first, in the status vocabulary's own order: a plan asking you a
 * question outranks one that merely moved while you were away. Then recents pad
 * the list out, which is where a `working` plan surfaces — something streaming
 * is not waiting on you, it is just active. Newest-first inside every tier.
 */
export function composeEmptyQueryPlanRows<T extends PlanRowStatusFields & { planId: string }>(
  plans: readonly T[],
  limit = EMPTY_QUERY_PLAN_LIMIT,
): T[] {
  if (limit <= 0) return [];

  const byStatus = (status: "awaiting-input" | "unseen") =>
    sortPlansNewestFirst(plans.filter((plan) => resolvePlanRowStatus(plan) === status));

  const ordered = [...byStatus("awaiting-input"), ...byStatus("unseen")];
  const taken = new Set(ordered.map((plan) => plan.planId));
  for (const plan of sortPlansNewestFirst(plans)) {
    if (ordered.length >= limit) break;
    if (taken.has(plan.planId)) continue;
    ordered.push(plan);
    taken.add(plan.planId);
  }

  return ordered.slice(0, limit);
}

/**
 * Where picking a project takes you: never the project itself.
 *
 * Its most recently active plan, or straight into composing its first — a
 * project row in the palette is a promise about work, not a container to land
 * in.
 */
export function resolveProjectPick<T extends { planId: string; updatedAt: string }>(
  plans: readonly T[],
): { readonly kind: "open-plan"; readonly planId: string } | { readonly kind: "start-first-plan" } {
  const newest = sortPlansNewestFirst(plans)[0];
  return newest === undefined
    ? { kind: "start-first-plan" }
    : { kind: "open-plan", planId: newest.planId };
}

/**
 * Which project you are standing in, if any.
 *
 * Inside a plan it is that plan's project; inside a draft it is the project the
 * draft was opened for — a draft is a project's unborn plan, so "new plan" from
 * there means the same project (and reuses that very draft). Anywhere else
 * there is nothing to assume, and the palette has to ask.
 */
export function resolveCurrentProjectId(input: {
  readonly pathname: string;
  readonly plans: readonly { readonly planId: string; readonly projectId: string }[];
  readonly draftsById: Readonly<Record<string, { readonly projectId: string }>>;
}): string | null {
  const segments = input.pathname.split("/").filter((segment) => segment.length > 0);
  const [first, second, third] = segments;
  if (first !== "plans" || second === undefined) return null;

  if (second === "draft") {
    if (third === undefined) return null;
    return input.draftsById[decodeURIComponent(third)]?.projectId ?? null;
  }

  const planId = decodeURIComponent(second);
  return input.plans.find((plan) => plan.planId === planId)?.projectId ?? null;
}

/**
 * The `>` prefix restricts to actions; everything else searches every kind.
 *
 * Ranking is the fork's ladder — exact over prefix over substring, earlier
 * search terms over later, ties keeping source order. For plans that source
 * order is the empty query's, so urgency stays the tiebreak among equally good
 * matches.
 */
export function filterSearchPaletteGroups(input: {
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly query: string;
}): CommandPaletteGroup[] {
  const isActionsFilter = input.query.startsWith(">");
  const normalizedQuery = normalizeSearchText(isActionsFilter ? input.query.slice(1) : input.query);
  const baseGroups = isActionsFilter
    ? input.groups.filter((group) => group.value === "actions")
    : [...input.groups];

  if (normalizedQuery.length === 0) {
    return baseGroups;
  }

  return baseGroups.flatMap((group) => {
    const items = Arr.filterMap(group.items, (item, index) => {
      const haystack = normalizeSearchText(item.searchTerms.join(" "));
      if (!haystack.includes(normalizedQuery)) {
        return Result.failVoid;
      }
      return Result.succeed({
        item,
        index,
        rank: rankCommandPaletteItemMatch(item, normalizedQuery),
      });
    })
      .toSorted((left, right) => right.rank - left.rank || left.index - right.index)
      .map((entry) => entry.item);

    return items.length === 0 ? [] : [{ value: group.value, label: group.label, items }];
  });
}

/** What each section row is called and answers to. */
export const SEARCH_PALETTE_SECTIONS: ReadonlyArray<{
  readonly section: SearchPaletteSection;
  readonly label: string;
  readonly path: "/repositories" | "/settings";
  readonly searchTerms: ReadonlyArray<string>;
}> = [
  {
    section: "repositories",
    label: "Repositories",
    path: "/repositories",
    searchTerms: ["Repositories", "repos", "git", "clone"],
  },
  {
    section: "settings",
    label: "Settings",
    path: "/settings",
    searchTerms: ["Settings", "preferences", "keybindings", "appearance", "providers"],
  },
];

/**
 * Only the groups that have something in them, in the resolved order: what you
 * can start, then what needs you.
 */
export function buildSearchPaletteGroups(input: {
  readonly actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  readonly planItems: ReadonlyArray<CommandPaletteActionItem>;
  readonly projectItems: ReadonlyArray<CommandPaletteActionItem>;
  readonly sectionItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  return [
    { value: "actions", label: "Actions", items: input.actionItems },
    { value: "plans", label: "Plans", items: input.planItems },
    { value: "projects", label: "Projects", items: input.projectItems },
    { value: "workspace", label: "Workspace", items: input.sectionItems },
  ].filter((group) => group.items.length > 0);
}

export function planItemValue(planId: string): string {
  return `plan:${planId}`;
}

export function projectItemValue(projectId: string): string {
  return `project:${projectId}`;
}
