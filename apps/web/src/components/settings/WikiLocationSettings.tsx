import { settingsFolder } from "@mercurian/wiki/placement";
import type {
  EnvironmentId,
  UnifiedSettings,
  WikiLocationSettings as Settings,
} from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const selectLocations = (settings: UnifiedSettings) => settings.wikiLocations;

const ATTACHMENTS: Readonly<Record<Settings["attachments"], string>> = {
  root: "Wiki root",
  folder: "A folder",
  beside: "Beside the document",
  subfolder: "A subfolder beside it",
};
const NEW_NOTES: Readonly<Record<Settings["newNotes"], string>> = {
  beside: "Beside the linking file",
  root: "Wiki root",
  folder: "A folder",
};

function Choice<Value extends string>({
  label,
  value,
  labels,
  onChange,
}: {
  readonly label: string;
  readonly value: Value;
  readonly labels: Readonly<Record<Value, string>>;
  readonly onChange: (value: Value) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null && next in labels) onChange(next as Value);
      }}
    >
      <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={label}>
        <SelectValue>{labels[value]}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {(Object.keys(labels) as Value[]).map((each) => (
          <SelectItem key={each} hideIndicator value={each}>
            {labels[each]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** A folder's path, saved when it's left. One no wiki can hold, `..` above all, isn't saved. */
function FolderField({
  label,
  value,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (folder: string) => void;
}) {
  const [text, setText] = useState(value);
  const folder = settingsFolder(text);
  return (
    <Input
      aria-label={label}
      aria-invalid={folder === null}
      className="w-full sm:w-48"
      size="sm"
      value={text}
      spellCheck={false}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (folder !== null && folder !== value) onCommit(folder);
      }}
    />
  );
}

/** Where a server's wikis put what's new, as Obsidian's Files and links settings do per vault. */
export function WikiLocationSettings({
  environmentId,
  serverLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string | null;
}) {
  const locations = useEnvironmentSettings(environmentId, selectLocations);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const update = (patch: Partial<Settings>) =>
    updateSettings({ wikiLocations: { ...locations, ...patch } });
  return (
    <SettingsSection title={serverLabel === null ? "New files" : `New files on ${serverLabel}`}>
      <SettingsRow
        title="Attachments"
        description="Where a pasted or dropped file lands. Missing folders are made."
        control={
          <Choice
            label="Attachments"
            value={locations.attachments}
            labels={ATTACHMENTS}
            onChange={(attachments) => update({ attachments })}
          />
        }
      />
      {locations.attachments === "folder" || locations.attachments === "subfolder" ? (
        <SettingsRow
          title={locations.attachments === "folder" ? "Attachment folder" : "Attachment subfolder"}
          description={
            locations.attachments === "folder"
              ? "A path from the top of the wiki."
              : "A path from the document's own folder."
          }
          control={
            <FolderField
              key={locations.attachments}
              label="Attachment folder"
              value={locations.attachmentFolder}
              onCommit={(attachmentFolder) => update({ attachmentFolder })}
            />
          }
        />
      ) : null}
      <SettingsRow
        title="New notes"
        description="Where a note made from a link with no folder in it lands. A link's folder always wins, and is made."
        control={
          <Choice
            label="New notes"
            value={locations.newNotes}
            labels={NEW_NOTES}
            onChange={(newNotes) => update({ newNotes })}
          />
        }
      />
      {locations.newNotes === "folder" ? (
        <SettingsRow
          title="New note folder"
          description="A path from the top of the wiki. If it doesn't exist, notes land at the top."
          control={
            <FolderField
              label="New note folder"
              value={locations.newNoteFolder}
              onCommit={(newNoteFolder) => update({ newNoteFolder })}
            />
          }
        />
      ) : null}
    </SettingsSection>
  );
}
