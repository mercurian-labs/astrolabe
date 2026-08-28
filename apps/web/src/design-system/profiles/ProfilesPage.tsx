import { useEffect, useRef, useState } from "react";

import { useDesignLabProfileActions } from "../../components/design-system/useDesignLabProfileActions";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useDesignLabProfilesStore } from "../../designLabProfiles";

export function ProfilesPage() {
  const profiles = useDesignLabProfilesStore((store) => store.profiles);
  const activeProfileId = useDesignLabProfilesStore((store) => store.activeProfileId);
  const saveProfile = useDesignLabProfilesStore((store) => store.saveProfile);
  const activeProfile = profiles.find(({ id }) => id === activeProfileId);
  const [name, setName] = useState(activeProfile?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actions = useDesignLabProfileActions();

  useEffect(() => {
    setName(activeProfile?.name ?? "");
  }, [activeProfile?.name]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:px-8">
      <SettingsSection title="Current direction">
        <SettingsRow
          title="Profile name"
          description="Save names the current whole-app direction. Without an active profile, adjustments remain as an unnamed machine-local working state."
          status={error}
          control={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Input
                aria-label="Profile name"
                className="w-full sm:w-56"
                maxLength={48}
                onChange={(event) => {
                  setError(null);
                  setName(event.currentTarget.value);
                }}
                placeholder="Direction name"
                value={name}
              />
              <Button
                disabled={name.trim().length === 0}
                onClick={() => {
                  try {
                    const saved = saveProfile(name);
                    setName(saved.name);
                    setError(null);
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : "The profile could not be saved.",
                    );
                  }
                }}
                size="xs"
              >
                Save
              </Button>
            </div>
          }
        />
        <SettingsRow
          title="Shipped appearance"
          description="Clear the working direction and return every Lab axis and theme to the product defaults."
          control={
            <Button onClick={actions.returnToShippedAppearance} size="xs" variant="outline">
              Return to shipped appearance
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Saved profiles"
        headerAction={
          <>
            <input
              ref={fileInputRef}
              accept=".json,application/json"
              aria-label="Import profile file"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                setError(null);
                void actions.importProfile(file).catch((cause: unknown) => {
                  setError(
                    cause instanceof Error ? cause.message : "The profile could not be imported.",
                  );
                });
              }}
              type="file"
            />
            <Button onClick={() => fileInputRef.current?.click()} size="xs" variant="outline">
              Import
            </Button>
          </>
        }
      >
        {profiles.length === 0 ? (
          <SettingsRow
            title="No saved profiles"
            description="Name and save the current direction, or import a profile file."
          />
        ) : (
          profiles.map((profile) => {
            const active = profile.id === activeProfileId;
            return (
              <SettingsRow
                key={profile.id}
                title={profile.name}
                description="A machine-local snapshot of all Lab axes and the selected theme."
                status={active ? "Active" : null}
                control={
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button
                      disabled={active}
                      onClick={() => actions.applyProfile(profile)}
                      size="xs"
                      variant="outline"
                    >
                      Apply
                    </Button>
                    <Button
                      onClick={() => actions.exportProfile(profile)}
                      size="xs"
                      variant="outline"
                    >
                      Export
                    </Button>
                    <Button
                      onClick={() => actions.proposeProfile(profile)}
                      size="xs"
                      variant="outline"
                    >
                      Propose
                    </Button>
                    <Button
                      onClick={() => actions.deleteProfile(profile)}
                      size="xs"
                      variant="outline"
                    >
                      Delete
                    </Button>
                  </div>
                }
              />
            );
          })
        )}
      </SettingsSection>
    </div>
  );
}
