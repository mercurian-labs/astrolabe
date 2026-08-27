import type { CSSProperties } from "react";

import { useDesignLabOverridesStore } from "../../designLabOverrides";
import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";

const RADIUS_PRESETS = [
  { label: "Sharp", value: 0 },
  { label: "Compact", value: 0.375 },
  { label: "Standard", value: 0.625 },
  { label: "Soft", value: 0.875 },
  { label: "Round", value: 1.125 },
] as const;

const DEFAULT_RADIUS_REM = 0.625;

function sliderStyle(value: number): CSSProperties {
  const ratio = value / 1.125;
  return {
    "--settings-slider-progress": `${ratio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
  } as CSSProperties;
}

export function AxisShapePage() {
  const radiusRem = useDesignLabOverridesStore((store) => store.radiusRem);
  const setOverrides = useDesignLabOverridesStore((store) => store.setOverrides);
  const resetShape = useDesignLabOverridesStore((store) => store.resetShape);
  const value = radiusRem ?? DEFAULT_RADIUS_REM;
  const resetAction =
    radiusRem === null ? null : <SettingResetButton label="corner radius" onClick={resetShape} />;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:px-8">
      <SettingsSection
        title="Shape"
        headerAction={
          <Button disabled={radiusRem === null} onClick={resetShape} size="xs" variant="outline">
            Reset axis
          </Button>
        }
      >
        <SettingsRow
          title="Corner stance"
          description="Choose a recognizable base stance before making a finer adjustment."
          resetAction={resetAction}
          control={
            <div className="flex flex-wrap justify-end gap-1">
              {RADIUS_PRESETS.map((preset) => (
                <Button
                  aria-pressed={value === preset.value}
                  key={preset.label}
                  onClick={() => setOverrides({ radiusRem: preset.value })}
                  size="xs"
                  variant={value === preset.value ? "secondary" : "outline"}
                >
                  {preset.label} {preset.value}
                </Button>
              ))}
            </div>
          }
        />
        <SettingsRow
          title="Fine radius"
          description="The root radius token; every standard rounded utility derives from it."
          resetAction={resetAction}
          control={
            <div className="flex w-full items-center gap-3 sm:w-64">
              <output
                className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums"
                htmlFor="axis-shape-radius"
              >
                {Number(value.toFixed(3))} rem
              </output>
              <input
                aria-label="Fine corner radius"
                className="settings-slider min-w-0 flex-1"
                id="axis-shape-radius"
                max={1.125}
                min={0}
                onChange={(event) => setOverrides({ radiusRem: Number(event.currentTarget.value) })}
                step={0.025}
                style={sliderStyle(value)}
                type="range"
                value={value}
              />
            </div>
          }
        />
      </SettingsSection>
    </div>
  );
}
