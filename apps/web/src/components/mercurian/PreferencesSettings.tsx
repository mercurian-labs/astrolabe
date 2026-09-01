import {
  getBackgroundActivityBaseProfile,
  getBackgroundActivityPresetSettings,
  resolveServerBackgroundActivitySettings,
} from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import { RefreshCwIcon } from "lucide-react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../settings/settingsLayout";
import {
  backgroundActivityOverrideSettings,
  durationToSeconds,
  fetchIntervalDiffersFromDefault,
  normalizeFetchIntervalSeconds,
  normalizeWorktreePoolSize,
} from "./PreferencesSettings.logic";

const FETCH_INTERVAL_STEP_SECONDS = 5;

export function PreferencesSettings() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const currentSeconds = durationToSeconds(
    resolveServerBackgroundActivitySettings(settings).automaticGitFetchInterval,
  );
  const defaultSeconds = durationToSeconds(
    getBackgroundActivityPresetSettings(
      getBackgroundActivityBaseProfile(settings.backgroundActivity),
    ).automaticGitFetchInterval,
  );
  const canReset = fetchIntervalDiffersFromDefault(currentSeconds, defaultSeconds);

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="background-refresh"
        title="Preferences"
        icon={<RefreshCwIcon className="size-4 text-muted-foreground" />}
      >
        <SettingsRow
          title="Background refresh"
          description="Set to 0 and remote status refreshes only when you act — credential prompts never fire in the background."
          status={currentSeconds === 0 ? "Background refresh is off." : null}
          resetAction={
            canReset ? (
              <SettingResetButton
                label="background refresh"
                onClick={() =>
                  updateSettings(
                    backgroundActivityOverrideSettings(settings.backgroundActivity, {
                      automaticGitFetchInterval: undefined,
                    }),
                  )
                }
              />
            ) : null
          }
          control={
            <>
              <NumberField
                value={currentSeconds}
                min={0}
                step={FETCH_INTERVAL_STEP_SECONDS}
                size="sm"
                className="w-32"
                onValueChange={(value) =>
                  updateSettings(
                    backgroundActivityOverrideSettings(settings.backgroundActivity, {
                      automaticGitFetchInterval: Duration.seconds(
                        normalizeFetchIntervalSeconds(value),
                      ),
                    }),
                  )
                }
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement aria-label="Decrease background refresh interval" />
                  <NumberFieldInput aria-label="Background refresh interval in seconds" />
                  <NumberFieldIncrement aria-label="Increase background refresh interval" />
                </NumberFieldGroup>
              </NumberField>
              <span className="text-xs text-muted-foreground">seconds</span>
            </>
          }
        />
        <SettingsRow
          title="Worktree pool size"
          description="Maximum warm coding worktree sets kept for each project. Running turns, terminals, and previews hold a slot."
          control={
            <NumberField
              value={settings.worktreePoolSize}
              min={1}
              step={1}
              size="sm"
              className="w-32"
              onValueChange={(value) =>
                updateSettings({ worktreePoolSize: normalizeWorktreePoolSize(value) })
              }
            >
              <NumberFieldGroup>
                <NumberFieldDecrement aria-label="Decrease worktree pool size" />
                <NumberFieldInput aria-label="Worktree pool size" />
                <NumberFieldIncrement aria-label="Increase worktree pool size" />
              </NumberFieldGroup>
            </NumberField>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
