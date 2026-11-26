/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type { EnvironmentId, UnifiedSettings, WikiMapBackground } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const selectBackgrounds = (settings: UnifiedSettings) => settings.wikiMapBackgrounds;

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function BackgroundForm({
  initial,
  onSave,
  onCancel,
}: {
  readonly initial: WikiMapBackground | null;
  readonly onSave: (background: WikiMapBackground) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [lightTiles, setLightTiles] = useState(initial?.lightTiles ?? "");
  const [darkTiles, setDarkTiles] = useState(initial?.darkTiles ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      name: name.trim(),
      lightTiles: lightTiles.trim(),
      darkTiles: darkTiles.trim() || null,
    });
  };
  return (
    <form className="flex flex-col gap-3 pt-3" onSubmit={submit}>
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            placeholder="Terrain"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Light mode"
        hint="A style URL, or a tile URL with {z}, {x} and {y}. It can hold an access key: it stays in this server's settings, out of every project's files."
      >
        {(id) => (
          <Input
            id={id}
            spellCheck={false}
            placeholder="https://tiles.openfreemap.org/styles/liberty"
            value={lightTiles}
            onChange={(event) => setLightTiles(event.target.value)}
          />
        )}
      </Field>
      <Field label="Dark mode (optional)" hint="Without one, dark mode uses the light tiles.">
        {(id) => (
          <Input
            id={id}
            spellCheck={false}
            placeholder="https://tiles.openfreemap.org/styles/dark"
            value={darkTiles}
            onChange={(event) => setDarkTiles(event.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" type="submit" disabled={name.trim() === "" || lightTiles.trim() === ""}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** The tiles every project's maps on a server draw on. The first is the default; a map can switch. */
export function WikiMapBackgrounds({
  environmentId,
  serverLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string | null;
}) {
  const backgrounds = useEnvironmentSettings(environmentId, selectBackgrounds);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const write = (next: ReadonlyArray<WikiMapBackground>) => {
    updateSettings({ wikiMapBackgrounds: next });
    setEditing(null);
  };
  const others = (index: number) => backgrounds.filter((_, position) => position !== index);

  return (
    <SettingsSection
      title={serverLabel === null ? "Map backgrounds" : `Map backgrounds on ${serverLabel}`}
      headerAction={
        <Button
          size="xs"
          variant="outline"
          disabled={editing !== null}
          onClick={() => setEditing("new")}
        >
          <PlusIcon />
          Add background
        </Button>
      }
    >
      {backgrounds.length === 0 && editing === null ? (
        <SettingsRow
          title="OpenFreeMap"
          description="Maps in a base use OpenFreeMap's free tiles until you add a background. A view that names its own tiles keeps them."
        />
      ) : null}
      {backgrounds.map((background, index) =>
        editing === index ? (
          <SettingsRow key={background.name} title={`Edit ${background.name}`}>
            <BackgroundForm
              initial={background}
              onSave={(edited) =>
                write(backgrounds.map((old, at) => (at === index ? edited : old)))
              }
              onCancel={() => setEditing(null)}
            />
          </SettingsRow>
        ) : (
          <SettingsRow
            key={background.name}
            title={background.name}
            status={index === 0 ? <Badge variant="outline">Default</Badge> : undefined}
            control={
              <div className="flex items-center gap-2">
                {index > 0 ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => write([background, ...others(index)])}
                  >
                    Make default
                  </Button>
                ) : null}
                <Button size="xs" variant="outline" onClick={() => setEditing(index)}>
                  Edit
                </Button>
                <Button size="xs" variant="outline" onClick={() => write(others(index))}>
                  Remove
                </Button>
              </div>
            }
          />
        ),
      )}
      {editing === "new" ? (
        <SettingsRow title="New background">
          <BackgroundForm
            initial={null}
            onSave={(added) => write([...backgrounds, added])}
            onCancel={() => setEditing(null)}
          />
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}
