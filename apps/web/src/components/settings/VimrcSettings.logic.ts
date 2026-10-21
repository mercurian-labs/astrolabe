import type { VimMapping, VimMappingMode, VimMappingTarget } from "@t3tools/contracts";

/** Astrolabe: the pure parts of Settings › Keybindings › Vim (`VimrcSettings.tsx`). */

export const VIM_MAPPING_MODE_LABELS: Readonly<Record<VimMappingMode, string>> = {
  normal: "Normal",
  visual: "Visual",
  insert: "Insert",
  all: "All",
};

/** Keys Vim names in brackets, as `@replit/codemirror-vim` reads them from a key event. */
const SPECIAL_KEYS: Readonly<Record<string, string>> = {
  Enter: "CR",
  Backspace: "BS",
  Delete: "Del",
  Escape: "Esc",
  Insert: "Ins",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  " ": "Space",
};

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "CapsLock",
  "Fn",
  "Dead",
  "Unidentified",
]);

/** Keys that move and edit in the field itself, unless held with Ctrl or Alt. */
const FIELD_KEYS = new Set([
  "Tab",
  "Enter",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export interface VimKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
}

/**
 * The Vim notation a key press records in a mapping's keys field (`<C-d>`, `<Space>`, `<F2>`),
 * as Vim names the same press in an editor; null for a press the field should take as typing (a
 * plain character, the field's own editing keys, and Cmd's shortcuts). On a Mac, Option with a
 * character types that character, as it does in Vim there.
 */
export function vimKeyNotation(event: VimKeyEvent, { mac }: { mac: boolean }): string | null {
  if (event.isComposing || event.metaKey || MODIFIER_KEYS.has(event.key)) return null;
  if (!event.ctrlKey && !event.altKey && FIELD_KEYS.has(event.key)) return null;
  const key = SPECIAL_KEYS[event.key] ?? event.key;
  let modifiers = `${event.ctrlKey ? "C-" : ""}${event.altKey ? "A-" : ""}`;
  if (mac && modifiers === "A-" && key.length === 1) modifiers = "";
  if ((modifiers || key.length > 1) && event.shiftKey) modifiers += "S-";
  const name = `${modifiers}${key}`;
  return name.length > 1 ? `<${name}>` : null;
}

/** Keys in Vim notation as the keycaps they show: `<C-d>w` is `C-d`, `w`. */
export function vimKeycaps(keys: string): readonly string[] {
  return keys.match(/<[^<>\s]+>|./gu)?.map((cap) => cap.replace(/^<(.+)>$/u, "$1")) ?? [];
}

/** What stops a mapping draft from saving, or null; `editing` is the row it replaces. */
export function vimMappingDraftIssue(
  draft: VimMapping,
  mappings: ReadonlyArray<VimMappingTarget>,
  editing: VimMappingTarget | null,
): string | null {
  if (draft.keys === "") return "Press or type the keys.";
  if (/\s/u.test(draft.keys)) return "Keys have no spaces: write a space as <Space>.";
  if (draft.does.trim() === "") return "Type the keys it sends.";
  if (draft.keys !== ":" && draft.keys.startsWith(":") && draft.mode !== "all") {
    return "An ex mapping (:W) works in All modes only.";
  }
  const same = (target: VimMappingTarget) =>
    target.mode === draft.mode && target.keys === draft.keys;
  if ((editing === null || !same(editing)) && mappings.some(same)) {
    return `${draft.keys} is already mapped in ${VIM_MAPPING_MODE_LABELS[draft.mode]}.`;
  }
  return null;
}
