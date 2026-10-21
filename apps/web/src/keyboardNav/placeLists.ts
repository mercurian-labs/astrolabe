import { isMacPlatform } from "@t3tools/shared/keybindings";

import { openLeaderFrom } from "~/whichKey/doors";
import { sidebarSectionSlot } from "~/whichKey/handles";
import { listMoveForKey, moveListCursor } from "./listCursor.logic";

/**
 * Astrolabe: moving through a place's list from the keyboard: the sidebar's rows (the Threads,
 * Wikis and Pull Requests sidebars draw them) and the icon rail's buttons. While a row has focus:
 * `j`/`k` (and the arrows) step to the next or previous row, `gg`/`G` (and Home/End) jump to
 * the ends, Enter does what a click does and Mod+Enter what a Mod-click does, `/` opens the
 * sidebar's search, and Escape hands focus to the place on the right. Group headers, folded rows
 * and controls inside a row are passed over. Each list is a roving tab stop: the row last focused
 * is its one stop in the tab order. The row reached by a key shows its focus ring
 * (`:focus-visible`), which marks where Enter would go beside the row showing now
 * (`aria-current`).
 */

interface PlaceList {
  /** The place holding the list. */
  readonly place: string;
  readonly row: string;
  /** What `/` does there; without it, `/` stays the page's. */
  readonly search?: (place: Element) => void;
}

/** Opens the sidebar's own search: the title row's search button, else its search field. */
function openSidebarSearch(sidebar: Element) {
  const section = sidebarSectionSlot.get();
  if (section?.openSearch) {
    section.openSearch();
    return;
  }
  const field = [...sidebar.querySelectorAll<HTMLInputElement>("input[type='search']")].find(
    (input) => input.getClientRects().length > 0,
  );
  field?.focus();
}

const SIDEBAR_LIST: PlaceList = {
  place: "[data-app-sidebar]",
  row: [
    "[data-testid='sidebar-row-card']",
    "[data-testid='sidebar-row-slim']",
    "[data-testid='sidebar-draft-row']",
    // Search results are options the search field points at, not rows to move to.
    "[data-testid='wiki-sidebar-row']:not([role='option'])",
    "[data-testid='wiki-sidebar-row-slim']:not([role='option'])",
    "[data-pull-request-key] > button",
    // The legacy Threads sidebar's rows (Settings › Legacy sidebar).
    "[data-testid^='thread-row-'][role='button']",
  ].join(", "),
  search: openSidebarSearch,
};

/** The icon rail's section buttons: Threads, Wikis, Pull Requests, Usage, Settings. */
const RAIL_LIST: PlaceList = {
  place: "[data-app-rail]",
  // Each button is a tooltip's trigger, which takes over `data-slot`; `data-sidebar` stays.
  row: "[data-sidebar='menu-button']",
};

const LISTS = [SIDEBAR_LIST, RAIL_LIST];

/** The list `row` is a row of, and the place holding it. */
function listOf(row: Element): { readonly list: PlaceList; readonly place: Element } | null {
  for (const list of LISTS) {
    if (!row.matches(list.row)) continue;
    const place = row.closest(list.place);
    if (place) return { list, place };
  }
  return null;
}

/** Whether `element` is a row of a place's list: a sidebar row, a rail button. */
export function isListRow(element: Element): boolean {
  return element instanceof HTMLElement && listOf(element) !== null;
}

const rowsIn = (place: Element, list: PlaceList) => [
  ...place.querySelectorAll<HTMLElement>(list.row),
];

const isReachable = (row: HTMLElement) =>
  row.getClientRects().length > 0 && row.closest("[inert], [hidden]") === null;

/** Each list's row last focused, its tab stop, by the place holding it. */
const stops = new WeakMap<Element, HTMLElement>();
let pendingG = false;
/** The row Enter last opened, which keeps focus while what it opened appears. */
let entered: HTMLElement | null = null;

/**
 * Whether focus is on the row Enter opened, so it stays in the list: a thread opened from the
 * keyboard does not hand focus to its composer, as a document or a pull request opened there
 * does not either. A click still does.
 */
export function keepsListFocus(): boolean {
  return entered !== null && entered === document.activeElement;
}

/** Forgets the row Enter opened, as a press anywhere does. */
export function forgetEnteredRow() {
  entered = null;
}

/** Whether a plain `key` on `target` is its list's (`j`, `g`, Home …), for the list alone. */
export function takesListKey(target: EventTarget | null, key: string): boolean {
  // With a `g` held over, every key that moves the list moves it, `g` included.
  return target instanceof Element && isListRow(target) && listMoveForKey(key, true).move !== null;
}

/** Makes `row` its list's one tab stop. */
export function roveTo(row: HTMLElement) {
  const found = listOf(row);
  if (!found) return;
  for (const other of rowsIn(found.place, found.list)) {
    if (other !== row && other.tabIndex !== -1) other.tabIndex = -1;
  }
  row.tabIndex = 0;
  stops.set(found.place, row);
}

/** Focuses `row` from the keyboard, scrolled into view, with its focus ring showing. */
export function focusListRow(row: HTMLElement) {
  roveTo(row);
  row.focus({ preventScroll: true, focusVisible: true });
  row.scrollIntoView({ block: "nearest" });
}

/**
 * Where focus lands in a place's list with nowhere to return to: its tab stop, else its current
 * row (`aria-current`: the open thread, the section on screen), else its first. Null for a place
 * with no list.
 */
export function listDefaultRow(place: Element): HTMLElement | null {
  const list = LISTS.find((candidate) => place.matches(candidate.place));
  if (!list) return null;
  const rows = rowsIn(place, list).filter(isReachable);
  const stop = stops.get(place);
  if (stop && rows.includes(stop)) return stop;
  return (
    rows.find((row) => {
      const current = row.getAttribute("aria-current");
      return current === "page" || current === "true";
    }) ??
    rows[0] ??
    null
  );
}

/** Presses `row` as a click would, with Mod held for Mod+Enter. */
function activate(row: HTMLElement, withMod: boolean) {
  const mac = isMacPlatform(navigator.platform);
  row.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: withMod && mac,
      ctrlKey: withMod && !mac,
    }),
  );
}

/**
 * Reads a keydown aimed at a list's row, ahead of the row's own handlers; true when the list
 * took it. `onEscape` hands focus to the place on the right.
 */
export function handleListKey(
  event: KeyboardEvent,
  options: { readonly onEscape: (row: HTMLElement) => void },
): boolean {
  const row = event.target;
  const found = row instanceof HTMLElement ? listOf(row) : null;
  if (!(row instanceof HTMLElement) || !found || event.isComposing || event.altKey) {
    pendingG = false;
    return false;
  }
  const take = () => {
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  const mod = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
  if (event.key === "Enter" && !event.shiftKey) {
    pendingG = false;
    if (event.repeat) return take();
    entered = row;
    activate(row, mod);
    return take();
  }
  // Every other chord stays the app's (Ctrl+H/J/K/L move between places).
  if (event.metaKey || event.ctrlKey) {
    pendingG = false;
    return false;
  }
  // The leader key opens the keyboard menu here too, where Space would otherwise press the row.
  const shiftedSpace = event.key === " " && event.shiftKey;
  if (!shiftedSpace && !event.repeat && openLeaderFrom(row, event.key)) {
    pendingG = false;
    return take();
  }
  const { list, place } = found;
  if (event.key === "/" && list.search) {
    pendingG = false;
    list.search(place);
    return take();
  }
  if (event.key === "Escape") {
    pendingG = false;
    options.onEscape(row);
    return take();
  }
  const step = listMoveForKey(event.key, pendingG);
  pendingG = step.pendingG;
  if (step.pendingG) return take();
  if (!step.move) return false;
  const rows = rowsIn(place, list);
  const at = moveListCursor(rows.map(isReachable), rows.indexOf(row), step.move);
  const next = at === null ? null : rows[at];
  if (next) focusListRow(next);
  return take();
}
