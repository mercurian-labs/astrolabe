import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";

/** Keydowns this module made, which the keyboard menu's own listener lets pass. */
const synthetic = new WeakSet<Event>();

export function isSyntheticKeybinding(event: Event) {
  return synthetic.has(event);
}

/**
 * The shortcut a command answers to, as the latest binding for it says: the one a keypress
 * would reach first.
 */
export function shortcutForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
) {
  return keybindings.findLast((binding) => binding.command === command)?.shortcut ?? null;
}

/**
 * Runs a keybinding command through the app's own shortcut handlers: presses its shortcut on
 * the page, as the keyboard would, so whatever listens for the command runs as it always does
 * (`sidebar.toggle`, `chat.new`, `view.reopenClosed`, …). The key lands on the page rather
 * than the focused element, so a focused editor does not take it as typing. False when the
 * command has no shortcut to press.
 */
export function runKeybindingCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  platform = navigator.platform,
): boolean {
  const shortcut = shortcutForCommand(keybindings, command);
  if (!shortcut) return false;
  const mac = isMacPlatform(platform);
  const event = new KeyboardEvent("keydown", {
    key: shortcut.key,
    metaKey: shortcut.metaKey || (shortcut.modKey && mac),
    ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !mac),
    shiftKey: shortcut.shiftKey,
    altKey: shortcut.altKey,
    bubbles: true,
    cancelable: true,
  });
  synthetic.add(event);
  document.body.dispatchEvent(event);
  return true;
}
