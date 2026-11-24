/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { useGT } from "gt-react";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

/** Astrolabe: whether saving a code file formats it with its language server first. */
export function FormatOnSaveRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const on = useClientSettings((settings) => settings.formatOnSave);
  return (
    <SettingsRow
      {...searchableSetting("format-on-save")}
      description="Format a repository code file with its language server when you save it with mod+s or :w. A formatter that takes too long is skipped, and the file saves as it is."
      resetAction={
        on !== DEFAULT_CLIENT_SETTINGS.formatOnSave ? (
          <SettingResetButton
            ariaLabel={gt("Reset format on save to default")}
            onClick={() =>
              updateClientSettings({ formatOnSave: DEFAULT_CLIENT_SETTINGS.formatOnSave })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={on}
          onCheckedChange={(checked) => updateClientSettings({ formatOnSave: Boolean(checked) })}
          aria-label="Format on save"
        />
      }
    />
  );
}
