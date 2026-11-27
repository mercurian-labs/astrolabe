/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type { ChangeGroupGroupingSettings } from "@t3tools/contracts";

import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
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
    description: "A thread's pull requests form one group.",
  },
  {
    key: "coordinator",
    title: "Same coordinator",
    description: "A coordinator's child threads, and what they open, join the coordinator's group.",
  },
  {
    key: "lineage",
    title: "Thread lineage",
    description: "A fork, and its pull requests, join the group of the thread it came from.",
  },
  {
    key: "references",
    title: "References",
    description:
      "A pull request in no group joins one whose titles share its issue key, and threads naming the key join it.",
  },
  {
    key: "sameBranch",
    title: "Same branch",
    description: "A thread working on a group's pull request branch joins the group.",
  },
  {
    key: "flagDocsBehind",
    title: "Flag documentation that falls behind",
    description: "A group says Docs behind when its code changed after its documentation.",
  },
  {
    key: "offerDocDrafts",
    title: "Offer drafts for missing documentation",
    description: "A group whose code has no documentation offers a new thread to draft some.",
  },
];

/**
 * Astrolabe: Settings › Change Requests. Grouping: the rules that add change requests to a
 * change group on their own, and what a group offers. Kept by the environment, where groups are
 * derived. Turning a rule off stops new members
 * joining by it; members already in a group stay until taken out by hand.
 */
export function ChangeRequestSettingsPanel() {
  const searchableSetting = useSearchableSetting();
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
