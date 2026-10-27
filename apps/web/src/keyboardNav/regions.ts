import { neighbourRegion, type FocusDirection, type RegionBox } from "./regions.logic";
import { focusListRow, isListRow, listDefaultRow } from "./placeLists";

/**
 * The places focus moves (`focus.left` …) go between: icon rail, sidebar, chat column and each
 * pane, never anything inside one. Each place remembers its last focus and focus returns there.
 * The place keys act from (last focused or pressed in) wears `data-focused-place`, marking its
 * front tab (`index.css`); the rail and sidebar have no tabs, so only their row's ring shows.
 */

const RAIL = "[data-app-rail]";
const SIDEBAR = "[data-app-sidebar]";
const CHAT_COLUMN = "[data-chat-column-maximized-away]";
const PANE = "[data-pane-id]";
/** The main area, a region of its own on pages with neither panes nor a chat (Settings). */
const MAIN = "[data-slot='sidebar-inset']";
const REGION = [RAIL, SIDEBAR, CHAT_COLUMN, PANE].join(", ");

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(", ");

/** What last had focus in each region, and when (a count, for `recency`). */
const remembered = new WeakMap<Element, Element>();
const focusedAt = new WeakMap<Element, number>();
let focusCount = 0;
/** The region last pressed or focused in, for a key that comes while focus is on the page. */
let lastRegion: HTMLElement | null = null;

/** Makes `region` the one keys act from, and marks it so. */
function actFrom(region: HTMLElement) {
  if (lastRegion === region) return;
  lastRegion?.removeAttribute("data-focused-place");
  lastRegion = region;
  region.setAttribute("data-focused-place", "");
}

/** The region `element` is in, if any. */
function regionOf(element: Element | null): HTMLElement | null {
  if (!element) return null;
  const region = element.closest<HTMLElement>(REGION);
  if (region) return region;
  const main = element.closest<HTMLElement>(MAIN);
  return main && !main.querySelector(REGION) ? main : null;
}

/** Whether a region is on screen: not collapsed, not hidden behind a maximized pane, not off it. */
function isShown(region: HTMLElement) {
  if (region.closest("[inert]")) return false;
  const sidebar = region.closest("[data-slot='sidebar']");
  if (sidebar?.getAttribute("data-state") === "collapsed") return false;
  const rect = region.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight
  );
}

/** Every region on screen. */
function shownRegions(): HTMLElement[] {
  const regions = [...document.querySelectorAll<HTMLElement>(REGION)].filter(isShown);
  const main = document.querySelector<HTMLElement>(MAIN);
  if (main && isShown(main) && !main.querySelector(REGION)) regions.push(main);
  return regions;
}

const boxOf = (element: Element): RegionBox => {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
};

/** The main area's first region: the chat column, else the focused pane, else any but the rail and the sidebar. */
function primaryRegion(regions: readonly HTMLElement[]) {
  return (
    regions.find((region) => region.matches(CHAT_COLUMN)) ??
    regions.find((region) => region.matches(`${PANE}[data-focused]`)) ??
    regions.find((region) => !region.matches(`${RAIL}, ${SIDEBAR}`)) ??
    regions[0] ??
    null
  );
}

/**
 * The region a key from `origin` acts from: the one focus is in, else the one last pressed or
 * focused in, else the main area's first.
 */
function currentRegion(origin: Element | null, regions: readonly HTMLElement[]) {
  const from = regionOf(origin);
  if (from && regions.includes(from)) return from;
  if (lastRegion && regions.includes(lastRegion)) return lastRegion;
  return primaryRegion(regions);
}

/** The place a key from `origin` acts from, as `regionToward` reads it; null with none on screen. */
export function placeOf(origin: Element | null): HTMLElement | null {
  return currentRegion(origin, shownRegions());
}

/**
 * The region `direction` moves to from `origin` (the element the key came from), as Vim chooses
 * a window; with nothing focused, from the main area. Null when there is none that way.
 */
export function regionToward(direction: FocusDirection, origin: Element | null) {
  const regions = shownRegions();
  const from = currentRegion(origin, regions);
  if (!from) return null;
  const candidates = regions
    .filter((region) => region !== from)
    .map((region) => ({ region, box: boxOf(region), recency: focusedAt.get(region) ?? 0 }));
  const next = neighbourRegion(boxOf(from), candidates, direction);
  // With focus on the page itself, the region it acts from is somewhere to land too.
  return next ?? (regionOf(origin) ? null : from);
}

function isUsable(element: Element | null, region: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    region.contains(element) &&
    !element.closest("[inert]") &&
    element.getClientRects().length > 0
  );
}

/** Where focus lands in a region it has not been in (or whose last focus is gone). */
function defaultTarget(region: HTMLElement): HTMLElement | null {
  if (region.matches(`${RAIL}, ${SIDEBAR}`)) {
    const row = listDefaultRow(region);
    if (row) return row;
  } else if (region.matches(CHAT_COLUMN)) {
    const composer = region.querySelector<HTMLElement>("[data-testid='composer-editor']");
    if (isUsable(composer, region)) return composer;
  } else if (region.matches(PANE)) {
    const pill = region.querySelector<HTMLElement>("[data-pane-tab][aria-selected='true']");
    if (isUsable(pill, region)) return pill;
  }
  return (
    [...region.querySelectorAll(FOCUSABLE)].find((element) => isUsable(element, region)) ?? null
  );
}

/**
 * Moves focus into `region`: back to what last had focus there, else to its default (the
 * composer, a pane's tab in front, the sidebar's current row, the rail's current section).
 */
export function focusRegion(region: HTMLElement) {
  const last = remembered.get(region) ?? null;
  const targets = [isUsable(last, region) ? last : null, defaultTarget(region)];
  for (const target of targets) {
    if (!target) continue;
    if (isListRow(target)) focusListRow(target);
    else target.focus();
    if (region.contains(document.activeElement)) break;
  }
  actFrom(region);
}

/** Records where focus is, per region, for `focusRegion` to return to. */
export function noteFocus(target: Element) {
  const region = regionOf(target);
  if (!region) return;
  remembered.set(region, target);
  focusedAt.set(region, ++focusCount);
  actFrom(region);
}

/** Records the region a press landed in, for a key that follows with focus on the page. */
export function notePointer(target: Element | null) {
  const region = regionOf(target);
  if (region) actFrom(region);
}
