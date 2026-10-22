import type { ChangeGroupGroupingSettings } from "@t3tools/contracts";

import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Each Grouping switch: its title and what it does, in the order the page shows them. */
const GROUPING_ROWS: ReadonlyArray<{
  readonly key: keyof ChangeGroupGroupingSettings;
  readonly title: string;
  readonly description: string;
}> = [
  {
    key: "sameThread",
    title: "Same thread",
    description: "A thread's pull requests and the wiki change requests it opened form one group.",
  },
  {
    key: "coordinator",
    title: "Same coordinator",
    description: "A coordinator's child threads, and what they open, join the coordinator's group.",
  },
  {
    key: "lineage",
    title: "Thread lineage",
    description: "A fork, and its change requests, join the group of the thread it came from.",
  },
  {
    key: "references",
    title: "References",
    description:
      "A change request in no group joins one whose titles share its issue key, and threads naming the key join it.",
  },
  {
    key: "sameBranch",
    title: "Same branch",
    description: "A thread working on a group's pull request branch joins the group.",
  },
  {
    key: "agentSuggestions",
    title: "Agent suggestions",
    description:
      "An agent can suggest change requests and threads, each with its reason, for you to accept or dismiss.",
  },
  {
    key: "flagDocsBehind",
    title: "Flag documentation that falls behind",
    description: "A group says Docs behind when its code changed after its documentation.",
  },
  {
    key: "offerDocDrafts",
    title: "Offer drafts for missing documentation",
    description: "A group whose code has no documentation offers to ask its thread to draft some.",
  },
  {
    key: "armByDefault",
    title: "Merge new groups with the code",
    description:
      "A new group's documentation merges the moment its code has, until you turn it off.",
  },
];

/**
 * Astrolabe: Settings › Change Requests. Grouping: the rules that add change requests to a
 * change group on their own, what an agent may do, and whether new groups merge together. Kept by
 * the environment, where groups are derived and merged. Turning a rule off stops new members
 * joining by it; members already in a group stay until taken out by hand.
 */
export function ChangeRequestSettingsPanel() {
  const { targets } = useSettingsScope();
  const settings = useScopedSettings().changeGroupGrouping;
  const updateSettings = useUpdateScopedSettings();
  const mixed = (key: keyof ChangeGroupGroupingSettings) =>
    targets.some((target) => target.settings.changeGroupGrouping[key] !== settings[key]);
  return (
    <SettingsPageContainer>
      <SettingsSection {...searchableSetting("change-group-grouping")}>
        {GROUPING_ROWS.map((row) => (
          <SettingsRow
            key={row.key}
            title={row.title}
            description={row.description}
            serverScoped
            settingKeys={["changeGroupGrouping"]}
            mixed={mixed(row.key)}
            control={
              <Switch
                mixed={mixed(row.key)}
                checked={mixed(row.key) ? false : settings[row.key]}
                onCheckedChange={(checked) =>
                  updateSettings({ changeGroupGrouping: { [row.key]: Boolean(checked) } })
                }
                aria-label={row.title}
              />
            }
          />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
