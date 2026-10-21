import { useAtomValue } from "@effect/atom-react";
import { resolveLeaderKey } from "@t3tools/contracts";
import { useState, type KeyboardEvent } from "react";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { leaderKeyLabel } from "~/whichKey/leader";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { VimModeSettingsRow } from "./VimModeSetting";

/**
 * Astrolabe: the Keybindings page's Vim and leader-key settings. Vim keybindings and the leader
 * key belong to this device (client settings), while the rest of the page edits the server's
 * keybindings and vimrc, which follow the user to every device on it.
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

/** Vim keybindings and the leader key: this device's, whichever server the page edits. */
export function KeybindingsDeviceSection() {
  return (
    <SettingsSection title="This device">
      <VimModeSettingsRow />
      <LeaderKeySettingsRow />
    </SettingsSection>
  );
}
