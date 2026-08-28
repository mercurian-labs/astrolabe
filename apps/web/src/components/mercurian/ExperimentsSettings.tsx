import { FlaskConicalIcon } from "lucide-react";

import { useExperiments } from "../../lib/experiments";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Switch } from "../ui/switch";

export function ExperimentsSettings() {
  const [experiments, setExperiments] = useExperiments();

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="experiments"
        title="Experiments"
        icon={<FlaskConicalIcon className="size-4 text-muted-foreground" />}
      >
        <SettingsRow
          title="Thread & Columns views"
          description="These walking readings are parked until they are rebuilt on continuable checkpoints. Turn them on in this development build to restore them."
          control={
            <Switch
              aria-label="Thread & Columns views"
              checked={experiments.historyWalkViews}
              onCheckedChange={(checked) =>
                setExperiments((current) => ({
                  ...current,
                  historyWalkViews: Boolean(checked),
                }))
              }
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
