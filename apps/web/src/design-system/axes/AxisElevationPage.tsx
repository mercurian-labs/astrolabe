import { MAX_GLASS_OPACITY, MIN_GLASS_OPACITY } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { useDesignLabOverridesStore } from "../../designLabOverrides";
import { useClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";

function sliderStyle(value: number, min: number, max: number): CSSProperties {
  const ratio = (value - min) / (max - min);
  return {
    "--settings-slider-progress": `${ratio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
  } as CSSProperties;
}

function AxisSlider({
  id,
  label,
  max,
  min,
  onChange,
  output,
  step,
  value,
}: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  output: string;
  step: number;
  value: number;
}) {
  return (
    <div className="flex w-full items-center gap-3 sm:w-64">
      <output
        className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums"
        htmlFor={id}
      >
        {output}
      </output>
      <input
        aria-label={label}
        className="settings-slider min-w-0 flex-1"
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        style={sliderStyle(value, min, max)}
        type="range"
        value={value}
      />
    </div>
  );
}

export function AxisElevationPage() {
  const settingsGlassOpacity = useClientSettings((settings) => settings.glassOpacity);
  const { resolvedTheme } = useTheme();
  const store = useDesignLabOverridesStore();
  const defaults =
    resolvedTheme === "dark" ? { blur: 16, saturation: 1.08 } : { blur: 12, saturation: 1.14 };
  const hasOverrides = [
    store.shadowOpacity,
    store.borderStrength,
    store.glassBlurPx,
    store.glassOpacityPct,
    store.glassSaturation,
  ].some((value) => value !== null);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:px-8">
      <SettingsSection
        title="Elevation & glass"
        headerAction={
          <Button
            disabled={!hasOverrides}
            onClick={store.resetElevation}
            size="xs"
            variant="outline"
          >
            Reset axis
          </Button>
        }
      >
        <SettingsRow
          title="Shadow strength"
          description={
            <>
              A root shadow color makes the app-wide stance easy to judge, but flattens the standard
              per-elevation alpha differences. Intentionally colored shadows remain local; see the{" "}
              <Link
                className="underline underline-offset-2"
                search={{ page: "audit", entry: "unmanaged-values" }}
                to="/design-lab"
              >
                unmanaged elevation debt
              </Link>
              .
            </>
          }
          resetAction={
            store.shadowOpacity === null ? null : (
              <SettingResetButton
                label="shadow strength"
                onClick={() => store.setOverrides({ shadowOpacity: null })}
              />
            )
          }
          control={
            <AxisSlider
              id="axis-shadow-strength"
              label="Shadow strength"
              max={0.4}
              min={0}
              onChange={(shadowOpacity) => store.setOverrides({ shadowOpacity })}
              output={`${Math.round((store.shadowOpacity ?? 0.1) * 100)}%`}
              step={0.01}
              value={store.shadowOpacity ?? 0.1}
            />
          }
        />
        <SettingsRow
          title="Border strength"
          description="Mix semantic borders toward canvas below 1× and toward text above 1×."
          resetAction={
            store.borderStrength === null ? null : (
              <SettingResetButton
                label="border strength"
                onClick={() => store.setOverrides({ borderStrength: null })}
              />
            )
          }
          control={
            <AxisSlider
              id="axis-border-strength"
              label="Border strength"
              max={2}
              min={0.25}
              onChange={(borderStrength) => store.setOverrides({ borderStrength })}
              output={`${(store.borderStrength ?? 1).toFixed(2)}×`}
              step={0.05}
              value={store.borderStrength ?? 1}
            />
          }
        />
        <SettingsRow
          title="Glass blur"
          description="Backdrop blur shared by the composer, top bar, menus, and dialogs."
          resetAction={
            store.glassBlurPx === null ? null : (
              <SettingResetButton
                label="glass blur"
                onClick={() => store.setOverrides({ glassBlurPx: null })}
              />
            )
          }
          control={
            <AxisSlider
              id="axis-glass-blur"
              label="Glass blur"
              max={32}
              min={0}
              onChange={(glassBlurPx) => store.setOverrides({ glassBlurPx })}
              output={`${store.glassBlurPx ?? defaults.blur}px`}
              step={1}
              value={store.glassBlurPx ?? defaults.blur}
            />
          }
        />
        <SettingsRow
          title="Glass opacity"
          description="Higher values make translucent application surfaces more solid."
          resetAction={
            store.glassOpacityPct === null ? null : (
              <SettingResetButton
                label="glass opacity"
                onClick={() => store.setOverrides({ glassOpacityPct: null })}
              />
            )
          }
          control={
            <AxisSlider
              id="axis-glass-opacity"
              label="Glass opacity"
              max={MAX_GLASS_OPACITY}
              min={MIN_GLASS_OPACITY}
              onChange={(glassOpacityPct) => store.setOverrides({ glassOpacityPct })}
              output={`${store.glassOpacityPct ?? settingsGlassOpacity}%`}
              step={5}
              value={store.glassOpacityPct ?? settingsGlassOpacity}
            />
          }
        />
        <SettingsRow
          title="Glass saturation"
          description="Color intensity retained through blurred surfaces."
          resetAction={
            store.glassSaturation === null ? null : (
              <SettingResetButton
                label="glass saturation"
                onClick={() => store.setOverrides({ glassSaturation: null })}
              />
            )
          }
          control={
            <AxisSlider
              id="axis-glass-saturation"
              label="Glass saturation"
              max={2}
              min={0.5}
              onChange={(glassSaturation) => store.setOverrides({ glassSaturation })}
              output={`${(store.glassSaturation ?? defaults.saturation).toFixed(2)}×`}
              step={0.02}
              value={store.glassSaturation ?? defaults.saturation}
            />
          }
        />
      </SettingsSection>
    </div>
  );
}
