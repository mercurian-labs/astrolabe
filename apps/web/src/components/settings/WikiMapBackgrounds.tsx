import type { EnvironmentId, WikiMapBackground, WikiSummary } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { wikiEnvironment } from "~/state/wiki";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Field } from "../wiki/WikiDialogs";
import { useWikiCommand } from "../wiki/wikiEnvironment";
import { SettingsRow, SettingsSection } from "./settingsLayout";

function BackgroundForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  readonly initial: WikiMapBackground | null;
  readonly busy: boolean;
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
        hint="A style URL, or a tile URL with {z}, {x} and {y}. It can hold an access key: it stays on this server, out of the wiki's files and its mirror."
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
        <Button
          size="xs"
          type="submit"
          disabled={busy || name.trim() === "" || lightTiles.trim() === ""}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

/** The tiles a wiki's maps draw on. The first is the default; a map with several can switch. */
export function WikiMapBackgrounds({
  environmentId,
  wiki,
}: {
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
}) {
  const canSet = useAtomValue(wikiEnvironment.setMapBackgrounds.permissionAtom(environmentId));
  const setBackgrounds = useWikiCommand(
    wikiEnvironment.setMapBackgrounds,
    "Couldn't change the map backgrounds",
  );
  const backgrounds = wiki.mapBackgrounds ?? [];
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const write = async (next: ReadonlyArray<WikiMapBackground>) => {
    setBusy(true);
    const outcome = await setBackgrounds({
      environmentId,
      input: { wikiId: wiki.wikiId, backgrounds: next },
    });
    setBusy(false);
    if (outcome.ok) setEditing(null);
  };
  const others = (index: number) => backgrounds.filter((_, position) => position !== index);

  return (
    <SettingsSection
      title="Map backgrounds"
      headerAction={
        <Button
          size="xs"
          variant="outline"
          disabled={!canSet || editing !== null}
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
          description="This wiki's maps use OpenFreeMap's free tiles until you add a background. A view that names its own tiles keeps them."
        />
      ) : null}
      {backgrounds.map((background, index) =>
        editing === index ? (
          <SettingsRow key={background.name} title={`Edit ${background.name}`}>
            <BackgroundForm
              initial={background}
              busy={busy}
              onSave={(edited) =>
                void write(backgrounds.map((old, at) => (at === index ? edited : old)))
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
                    disabled={!canSet || busy}
                    onClick={() => void write([background, ...others(index)])}
                  >
                    Make default
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canSet || busy}
                  onClick={() => setEditing(index)}
                >
                  Edit
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canSet || busy}
                  onClick={() => void write(others(index))}
                >
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
            busy={busy}
            onSave={(added) => void write([...backgrounds, added])}
            onCancel={() => setEditing(null)}
          />
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}
