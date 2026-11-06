import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

type Feature = "inlayHints" | "inlayHintTypes" | "inlayHintParameters" | "inlineDiagnostics";

function FeatureRow(props: {
  readonly feature: Feature;
  readonly label: string;
  readonly description: string;
  readonly settingId?: Parameters<typeof searchableSetting>[0];
  readonly disabled?: boolean;
}) {
  const { feature, label } = props;
  const on = useClientSettings((settings) => settings[feature]);
  return (
    <SettingsRow
      {...(props.settingId ? searchableSetting(props.settingId) : { title: label })}
      description={props.description}
      resetAction={
        on !== DEFAULT_CLIENT_SETTINGS[feature] ? (
          <SettingResetButton
            label={label.toLowerCase()}
            onClick={() => updateClientSettings({ [feature]: DEFAULT_CLIENT_SETTINGS[feature] })}
          />
        ) : null
      }
      control={
        <Switch
          checked={on}
          disabled={props.disabled === true}
          onCheckedChange={(checked) => updateClientSettings({ [feature]: Boolean(checked) })}
          aria-label={label}
        />
      }
    />
  );
}

/** Astrolabe: what a code file's language server draws in the text, for this client. */
export function LanguageFeatureRows() {
  const hints = useClientSettings((settings) => settings.inlayHints);
  return (
    <>
      <FeatureRow
        feature="inlayHints"
        settingId="inlay-hints"
        label="Inlay hints"
        description="Show what a code file's language server knows beside the text, without changing it. A hint that can be written into the file does so when clicked."
      />
      <FeatureRow
        feature="inlayHintTypes"
        label="Type hints"
        description="Types of variables and return values."
        disabled={!hints}
      />
      <FeatureRow
        feature="inlayHintParameters"
        label="Parameter hints"
        description="Parameter names at a call."
        disabled={!hints}
      />
      <FeatureRow
        feature="inlineDiagnostics"
        settingId="inline-diagnostics"
        label="Inline diagnostics"
        description="Show each line's worst problem at the end of the line, cut off where the line ends."
      />
    </>
  );
}
