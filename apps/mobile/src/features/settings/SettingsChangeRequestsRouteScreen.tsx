import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
  type ChangeGroupGroupingSettings,
} from "@t3tools/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

const ROWS: ReadonlyArray<{
  readonly key: keyof ChangeGroupGroupingSettings;
  readonly label: string;
  readonly subtitle: string;
}> = [
  {
    key: "sameThread",
    label: "Same thread",
    subtitle: "A thread's pull requests and its wiki changes form one group.",
  },
  {
    key: "coordinator",
    label: "Same coordinator",
    subtitle: "A coordinator's children join its group.",
  },
  {
    key: "lineage",
    label: "Thread lineage",
    subtitle: "A fork joins the group of the thread it came from.",
  },
  {
    key: "references",
    label: "References",
    subtitle: "Change requests sharing an issue key join.",
  },
  {
    key: "agentSuggestions",
    label: "Agent suggestions",
    subtitle: "An agent suggests members for you to accept.",
  },
  {
    key: "flagDocsBehind",
    label: "Flag documentation that falls behind",
    subtitle: "Docs behind, when code changed after its docs.",
  },
  {
    key: "offerDocDrafts",
    label: "Offer drafts for missing documentation",
    subtitle: "Ask the thread to draft docs the code lacks.",
  },
  {
    key: "armByDefault",
    label: "Merge new groups with the code",
    subtitle: "Docs merge the moment their code has.",
  },
];

/**
 * Astrolabe: Settings › Change requests › Grouping on the phone, as on web: the rules that add
 * change requests to a group, what an agent may do, and whether new groups merge together. Kept
 * by each selected environment.
 */
export function SettingsChangeRequestsRouteScreen() {
  const insets = useSafeAreaInsets();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const writable = useEnvironmentsWithScope(selectedTargets, AuthSettingsWriteScope);
  const reference = selectedTargets[0] ?? null;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "server settings update",
    reportFailure: true,
  });
  const canWrite =
    selectedTargets.length > 0 &&
    selectedTargets.every((target) => writable.has(target.environmentId));
  const write = (key: keyof ChangeGroupGroupingSettings, value: boolean) => {
    for (const target of selectedTargets) {
      void updateSettings({
        environmentId: target.environmentId,
        input: { patch: { changeGroupGrouping: { [key]: value } } },
      });
    }
  };
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Change requests" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {reference ? (
            <GroupingSection
              environmentId={reference.environmentId}
              disabled={!canWrite}
              onChange={write}
            />
          ) : null}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

/** The switches, showing the first selected environment's settings. */
function GroupingSection(props: {
  readonly environmentId: Parameters<typeof serverEnvironment.settingsValueAtom>[0];
  readonly disabled: boolean;
  readonly onChange: (key: keyof ChangeGroupGroupingSettings, value: boolean) => void;
}) {
  const settings =
    useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId))?.changeGroupGrouping ??
    DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS;
  return (
    <SettingsSection title="Grouping">
      {ROWS.map((row) => (
        <SettingsSwitchRow
          key={row.key}
          icon={PullRequestGlyph.pullRequest}
          label={row.label}
          subtitle={row.subtitle}
          value={settings[row.key]}
          disabled={props.disabled}
          onValueChange={(value) => props.onChange(row.key, value)}
        />
      ))}
    </SettingsSection>
  );
}
