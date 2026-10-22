import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { vimQuitGate } from "./vimQuitGate";

/**
 * Astrolabe: Vim in the composer and the wiki's note editor, a device setting. Turning it
 * off is one click; turning it on first asks for `:q` in a small Vim editor beneath the
 * row, so whoever turns it on has shown they know the way out.
 */
export function VimModeSettingsRow() {
  const on = useClientSettings((settings) => settings.vimModeEnabled);
  const [asking, setAsking] = useState(false);
  const switchRef = useRef<HTMLButtonElement>(null);
  // Vim turned on, here or in another window, answers the question: the gate opens again
  // only from the switch.
  if (asking && on) setAsking(false);
  const confirming = asking && !on;

  const confirm = () => {
    updateClientSettings({ vimModeEnabled: true });
    setAsking(false);
  };
  const cancel = () => setAsking(false);

  // The gate takes focus while it is open and gives it back to the switch as it closes.
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirming) switchRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <SettingsRow
      {...searchableSetting("vim-mode")}
      description="Edit the composer and wiki notes with Vim's modes and motions."
      resetAction={
        on !== DEFAULT_CLIENT_SETTINGS.vimModeEnabled ? (
          <SettingResetButton
            label="Vim keybindings"
            onClick={() =>
              updateClientSettings({ vimModeEnabled: DEFAULT_CLIENT_SETTINGS.vimModeEnabled })
            }
          />
        ) : null
      }
      control={
        <Switch
          ref={switchRef}
          checked={on}
          onCheckedChange={(checked) => {
            if (!checked) updateClientSettings({ vimModeEnabled: false });
            setAsking(checked);
          }}
          aria-label="Vim keybindings"
        />
      }
    >
      {confirming ? <VimQuitGate onConfirm={confirm} onCancel={cancel} /> : null}
    </SettingsRow>
  );
}

/** The `:q` prompt. `onConfirm` and `onCancel` keep their identity: a new one starts over. */
function VimQuitGate({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = editorRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({ extensions: vimQuitGate({ onConfirm, onCancel }) }),
    });
    view.focus();
    return () => view.destroy();
  }, [onConfirm, onCancel]);

  return (
    <div className="space-y-2 pb-2">
      <p className="text-xs text-muted-foreground">
        Vim takes over the editors' keys. Type <code>:q</code> and press Enter to show you know the
        way out.
      </p>
      <div className="flex items-start gap-2">
        <div
          ref={editorRef}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
        />
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
