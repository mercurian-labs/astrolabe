import type {
  EnvironmentId,
  UnifiedSettings,
  WikiCanvasSettings as Settings,
} from "@t3tools/contracts";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const selectCanvas = (settings: UnifiedSettings) => settings.wikiCanvas;

const WHEEL: Readonly<Record<Settings["wheel"], string>> = { pan: "Pan", zoom: "Zoom" };
const CARD_NAMES: Readonly<Record<Settings["cardNames"], string>> = {
  always: "Always",
  hover: "On hover",
  never: "Never",
};
const SIMPLE_ZOOMS: ReadonlyArray<readonly [string, number, string]> = [
  ["15", 0.15, "15%"],
  ["20", 0.2, "20%"],
  ["30", 0.3, "30%"],
  ["50", 0.5, "50%"],
];

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
      <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={label}>
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

/** How a server's boards behave, as Obsidian keeps per vault. A board's menu writes the snaps too. */
export function WikiCanvasSettings({
  environmentId,
  serverLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string | null;
}) {
  const canvas = useEnvironmentSettings(environmentId, selectCanvas);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const update = (patch: Partial<Settings>) =>
    updateSettings({ wikiCanvas: { ...canvas, ...patch } });
  const simpleZoom = SIMPLE_ZOOMS.find(([, zoom]) => zoom === canvas.simpleZoom)?.[0] ?? "30";
  return (
    <SettingsSection title={serverLabel === null ? "Canvases" : `Canvases on ${serverLabel}`}>
      <SettingsRow
        title="New canvases"
        description="A new canvas goes at the top of the wiki, or in the folder you type before its name."
      />
      <SettingsRow
        title="Mouse wheel"
        description="What scrolling does on a board. ⌘ and scroll does the other."
        control={
          <Choice
            label="Mouse wheel"
            value={canvas.wheel}
            labels={WHEEL}
            onChange={(wheel) => update({ wheel })}
          />
        }
      />
      <SettingsRow
        title="Card names"
        description="The name above a file card."
        control={
          <Choice
            label="Card names"
            value={canvas.cardNames}
            labels={CARD_NAMES}
            onChange={(cardNames) => update({ cardNames })}
          />
        }
      />
      <SettingsRow
        title="Snap to grid"
        description="Moved and resized cards land on a 20-point grid."
        control={
          <Switch
            checked={canvas.snapToGrid}
            aria-label="Snap to grid"
            onCheckedChange={(snapToGrid) => update({ snapToGrid })}
          />
        }
      />
      <SettingsRow
        title="Snap to objects"
        description="A moved card lines up with the cards near it, ahead of the grid."
        control={
          <Switch
            checked={canvas.snapToObjects}
            aria-label="Snap to objects"
            onCheckedChange={(snapToObjects) => update({ snapToObjects })}
          />
        }
      />
      <SettingsRow
        title="Hide card content below"
        description="Zoomed out past this, cards show only their names."
        control={
          <Choice
            label="Hide card content below"
            value={simpleZoom}
            labels={Object.fromEntries(SIMPLE_ZOOMS.map(([key, , label]) => [key, label]))}
            onChange={(next) =>
              update({
                simpleZoom: SIMPLE_ZOOMS.find(([key]) => key === next)?.[1] ?? canvas.simpleZoom,
              })
            }
          />
        }
      />
    </SettingsSection>
  );
}
