import { isEditableFocused } from "~/lib/editableFocus";
import { CHORD, CURSOR_DOWN, CURSOR_UP, menuKeyLabel } from "./menu";

/** The keys a keyboard event carries, as the rules below read them. */
type KeyPress = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
};

const CONTROLS = [
  "button",
  "a[href]",
  "select",
  "summary",
  "iframe",
  "video[controls]",
  "audio[controls]",
  ...[
    "button",
    "link",
    "tab",
    "switch",
    "checkbox",
    "radio",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "combobox",
    "slider",
    "spinbutton",
    "treeitem",
    "gridcell",
  ].map((role) => `[role='${role}']`),
].join(", ");

/**
 * Whether a plain key belongs to the focused element, as the browser has it: a button, link, tab,
 * switch, menu item or option, a frame, or anything else in the tab order (a scroll region,
 * say, which Space pages).
 */
function isKeyboardControl(element: Element | null): boolean {
  if (!(element instanceof HTMLElement) || element === document.body) return false;
  if (element.closest(CONTROLS)) return true;
  return element.hasAttribute("tabindex") && element.tabIndex >= 0;
}

/** Whether a key comes without ⌘, Ctrl or Alt; Shift is part of the key it types. */
function isPlainKey(event: KeyPress): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** Whether focus is in a dialog (a modal, a popover), whose keys are its own. */
export function isInDialog(element: Element | null): boolean {
  return element?.closest("[role='dialog'], [role='alertdialog']") != null;
}

/**
 * Whether a keydown is the device's leader key (Space unless set otherwise), the menu's door
 * outside editors: the key pressed plainly (Space without Shift), not held, while focus is on no
 * text field, no control, and in no dialog (an editor's Vim offers its own leader key, through
 * `vimHostKeys`). Never with no leader key.
 */
export function isLeaderKey(
  event: KeyPress,
  target: EventTarget | null,
  options: { readonly leaderKey: string | null },
): boolean {
  const { leaderKey } = options;
  if (leaderKey === null || event.key !== leaderKey || !isPlainKey(event)) return false;
  if (leaderKey === " " && event.shiftKey) return false;
  if (event.repeat || event.isComposing) return false;
  const element = target instanceof Element ? target : null;
  return !isEditableFocused(element) && !isKeyboardControl(element) && !isInDialog(element);
}

/** The leader key as the menu's breadcrumb and the settings name it. */
export function leaderKeyLabel(leaderKey: string): string {
  return leaderKey === " " ? "Space" : leaderKey;
}

/** Menu keys as the keycaps read them: `t ]`, Space by name, the arrows as arrows. */
export function menuKeysLabel(sequence: readonly string[]): string {
  return sequence.map(menuKeyLabel).join(" ");
}

/** Keys that only modify another; pressing one alone chooses nothing. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "Fn"]);

/**
 * The key the open menu reads from a keydown: `key` when pressed plainly, `CHORD` for the menu's
 * chord, cursor keys for Ctrl+N/Ctrl+P on a Mac (as macOS lists move; elsewhere they are app
 * shortcuts), and an empty key for any other chord. Null for keys the menu ignores: a bare
 * modifier, a held key (except arrows, which step), or one composing text.
 */
export function menuKeyOf(
  event: KeyPress,
  isChord: boolean,
  options: { readonly mac: boolean },
): string | null {
  if (event.isComposing || MODIFIERS.has(event.key)) return null;
  if (isChord) return event.repeat ? null : CHORD;
  const step = options.mac ? macListStep(event) : null;
  if (step !== null) return step === "ArrowDown" ? CURSOR_DOWN : CURSOR_UP;
  if (event.repeat && event.key !== "ArrowDown" && event.key !== "ArrowUp") return null;
  return isPlainKey(event) ? event.key : "";
}

/** ArrowDown or ArrowUp for Ctrl+N or Ctrl+P alone, as macOS lists read them; else null. */
export function macListStep(event: KeyPress): "ArrowDown" | "ArrowUp" | null {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return key === "n" ? "ArrowDown" : key === "p" ? "ArrowUp" : null;
}
