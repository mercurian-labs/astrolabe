import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_MENU_REPEAT_WINDOW_MS,
  MAX_MENU_REPEAT_WINDOW_MS,
  resolveLeaderKey,
} from "@t3tools/contracts";
import { useState, type KeyboardEvent } from "react";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { leaderKeyLabel } from "~/whichKey/leader";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { VimModeSettingsRow } from "./VimModeSetting";

/**
 * Astrolabe: the Keybindings page's Vim, leader-key and repeat-window settings. They belong to
 * this device (client settings), while the rest of the page edits the server's keybindings and
 * vimrc, which follow the user to every device on it.
 */

type LeaderChoice = "space" | "key" | "none";

/** Keys that cannot lead: they close, move, or edit in the menu and fields. */
const UNLEADING_KEYS = new Set(["Escape", "Enter", "Tab", "Backspace", "Delete"]);
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "Fn"]);

function LeaderKeySettingsRow() {
  const leaderKey = useClientSettings(resolveLeaderKey);
  const [recording, setRecording] = useState(false);
  // The menu's own chord, as the menu names it.
  const chordLabel =
    shortcutLabelForCommand(useAtomValue(primaryServerKeybindingsAtom), "whichKey.open") ?? "⌘K";
  const choice: LeaderChoice = leaderKey === " " ? "space" : leaderKey === null ? "none" : "key";

  const record = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    if (MODIFIER_KEYS.has(event.key) || UNLEADING_KEYS.has(event.key)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    updateClientSettings({ leaderKey: event.key });
    setRecording(false);
  };

  return (
    <SettingsRow
      {...searchableSetting("leader-key")}
      description={`Another way to open the keyboard menu, besides ${chordLabel}. Works while you are not typing, and in Vim's normal mode.`}
      resetAction={
        leaderKey !== " " ? (
          <SettingResetButton
            label="leader key"
            onClick={() => updateClientSettings({ leaderKey: " " })}
          />
        ) : null
      }
      control={
        recording ? (
          <Input
            autoFocus
            aria-label="Press the leader key"
            placeholder="Press a key"
            size="sm"
            className="w-36"
            value=""
            onChange={() => {}}
            onKeyDown={record}
            onBlur={() => setRecording(false)}
          />
        ) : (
          <div className="flex items-center gap-2">
            {choice === "key" && leaderKey !== null ? <Kbd>{leaderKeyLabel(leaderKey)}</Kbd> : null}
            <Select
              value={choice}
              onValueChange={(value) => {
                if (value === "space") updateClientSettings({ leaderKey: " " });
                else if (value === "none") updateClientSettings({ leaderKey: null });
                else if (value === "key") setRecording(true);
              }}
            >
              <SelectTrigger size="sm" aria-label="Leader key">
                <SelectValue>
                  {(value: LeaderChoice) =>
                    value === "space" ? "Space" : value === "none" ? "None" : "Another key"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="space">Space</SelectItem>
                <SelectItem value="key">Another key…</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        )
      }
    />
  );
}

/** Raw milliseconds; grouping would show "1,000". */
const NO_GROUPING = { useGrouping: false } as const;

/** How long the menu's focus moves and scrolls keep their keys after one ran from the menu. */
function RepeatWindowSettingsRow() {
  const windowMs = useClientSettings((settings) => settings.menuRepeatWindowMs);
  return (
    <SettingsRow
      {...searchableSetting("menu-repeat-window")}
      description="After a focus move or a scroll from the keyboard menu, its keys (the arrows, h, j, k, l, d and u) keep working for this long without opening the menu again. Each one restarts it, landing in a text field ends it, and 0 turns it off."
      resetAction={
        windowMs !== DEFAULT_MENU_REPEAT_WINDOW_MS ? (
          <SettingResetButton
            label="repeat window"
            onClick={() =>
              updateClientSettings({ menuRepeatWindowMs: DEFAULT_MENU_REPEAT_WINDOW_MS })
            }
          />
        ) : null
      }
      control={
        <div className="flex items-center gap-2">
          <NumberField
            value={windowMs}
            min={0}
            max={MAX_MENU_REPEAT_WINDOW_MS}
            step={100}
            format={NO_GROUPING}
            size="sm"
            className="w-24"
            onValueCommitted={(value) => {
              if (value === null || value === windowMs) return;
              updateClientSettings({ menuRepeatWindowMs: Math.round(value) });
            }}
          >
            <NumberFieldGroup>
              <NumberFieldInput aria-label="Repeat window in milliseconds" />
            </NumberFieldGroup>
          </NumberField>
          <span className="text-xs text-muted-foreground">ms</span>
        </div>
      }
    />
  );
}

/** The keyboard settings that are this device's, whichever server the page edits. */
export function KeybindingsDeviceSection() {
  return (
    <SettingsSection title="This device">
      <VimModeSettingsRow />
      <LeaderKeySettingsRow />
      <RepeatWindowSettingsRow />
    </SettingsSection>
  );
}
