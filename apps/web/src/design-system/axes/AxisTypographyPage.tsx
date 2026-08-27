import {
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
} from "@t3tools/contracts";
import { useMemo, type CSSProperties } from "react";

import {
  DEFAULT_CODE_FONT_STACK,
  DEFAULT_SANS_FONT_STACK,
  resolveDefaultFamilyLabel,
} from "../../appearanceFonts";
import { useDesignLabOverridesStore } from "../../designLabOverrides";
import { useClientSettings } from "../../hooks/useSettings";
import { FontFamilyPicker } from "../../components/settings/FontFamilyPicker";
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

function SizeControl({
  id,
  label,
  max,
  min,
  onChange,
  value,
}: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="flex w-full items-center gap-3 sm:w-56">
      <output
        className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums"
        htmlFor={id}
      >
        {value}px
      </output>
      <input
        aria-label={label}
        className="settings-slider min-w-0 flex-1"
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={1}
        style={sliderStyle(value, min, max)}
        type="range"
        value={value}
      />
    </div>
  );
}

export function AxisTypographyPage() {
  const settings = useClientSettings();
  const store = useDesignLabOverridesStore();
  const defaults = useMemo(
    () => ({
      sans: resolveDefaultFamilyLabel(DEFAULT_SANS_FONT_STACK) ?? "System default",
      code: resolveDefaultFamilyLabel(DEFAULT_CODE_FONT_STACK) ?? "System monospace",
    }),
    [],
  );
  const interfaceFamily = store.fontSans ?? settings.fontFamilySans;
  const composerFamily = store.fontComposer ?? settings.fontFamilyComposer;
  const codeFamily = store.fontCode ?? settings.fontFamilyCode;
  const interfaceSize = store.sizeInterface ?? settings.fontSizeInterface;
  const promptSize = store.sizePrompt ?? settings.fontSizePrompt;
  const codeSize = store.sizeCode ?? settings.fontSizeCode;
  const hasOverrides = [
    store.fontSans,
    store.fontComposer,
    store.fontCode,
    store.sizeInterface,
    store.sizePrompt,
    store.sizeCode,
  ].some((value) => value !== null);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:px-8">
      <SettingsSection
        title="Typography"
        headerAction={
          <Button
            disabled={!hasOverrides}
            onClick={store.resetTypography}
            size="xs"
            variant="outline"
          >
            Reset axis
          </Button>
        }
      >
        <SettingsRow
          title="Interface voice"
          description="Navigation, controls, prose, and every non-code application surface."
          resetAction={
            store.fontSans === null ? null : (
              <SettingResetButton
                label="interface font family"
                onClick={() => store.setOverrides({ fontSans: null })}
              />
            )
          }
          control={
            <div className="w-full sm:w-56">
              <FontFamilyPicker
                ariaLabel="Interface font family"
                defaultFamily={defaults.sans}
                onSelect={(fontSans) => store.setOverrides({ fontSans })}
                selectedFamily={interfaceFamily}
              />
            </div>
          }
        />
        <SettingsRow
          title="Interface size"
          description="Scales the root font size and every rem-based dimension with it."
          resetAction={
            store.sizeInterface === null ? null : (
              <SettingResetButton
                label="interface font size"
                onClick={() => store.setOverrides({ sizeInterface: null })}
              />
            )
          }
          control={
            <SizeControl
              id="axis-interface-size"
              label="Interface font size"
              max={MAX_INTERFACE_FONT_SIZE}
              min={MIN_INTERFACE_FONT_SIZE}
              onChange={(sizeInterface) => store.setOverrides({ sizeInterface })}
              value={interfaceSize}
            />
          }
        />
        <SettingsRow
          title="Prompt voice"
          description="The composer voice, independent from the surrounding interface."
          resetAction={
            store.fontComposer === null ? null : (
              <SettingResetButton
                label="prompt font family"
                onClick={() => store.setOverrides({ fontComposer: null })}
              />
            )
          }
          control={
            <div className="w-full sm:w-56">
              <FontFamilyPicker
                ariaLabel="Prompt font family"
                defaultFamily={interfaceFamily.trim() || defaults.sans}
                onSelect={(fontComposer) => store.setOverrides({ fontComposer })}
                selectedFamily={composerFamily}
              />
            </div>
          }
        />
        <SettingsRow
          title="Prompt size"
          description="The absolute text size inside the composer."
          resetAction={
            store.sizePrompt === null ? null : (
              <SettingResetButton
                label="prompt font size"
                onClick={() => store.setOverrides({ sizePrompt: null })}
              />
            )
          }
          control={
            <SizeControl
              id="axis-prompt-size"
              label="Prompt font size"
              max={MAX_PROMPT_FONT_SIZE}
              min={MIN_PROMPT_FONT_SIZE}
              onChange={(sizePrompt) => store.setOverrides({ sizePrompt })}
              value={promptSize}
            />
          }
        />
        <SettingsRow
          title="Code voice"
          description="Code blocks, diffs, and file previews; only fixed-width faces are offered."
          resetAction={
            store.fontCode === null ? null : (
              <SettingResetButton
                label="code font family"
                onClick={() => store.setOverrides({ fontCode: null })}
              />
            )
          }
          control={
            <div className="w-full sm:w-56">
              <FontFamilyPicker
                ariaLabel="Code font family"
                defaultFamily={defaults.code}
                onSelect={(fontCode) => store.setOverrides({ fontCode })}
                requireMonospace
                selectedFamily={codeFamily}
              />
            </div>
          }
        />
        <SettingsRow
          title="Code size"
          description="The absolute text size for code and diff surfaces."
          resetAction={
            store.sizeCode === null ? null : (
              <SettingResetButton
                label="code font size"
                onClick={() => store.setOverrides({ sizeCode: null })}
              />
            )
          }
          control={
            <SizeControl
              id="axis-code-size"
              label="Code font size"
              max={MAX_CODE_FONT_SIZE}
              min={MIN_CODE_FONT_SIZE}
              onChange={(sizeCode) => store.setOverrides({ sizeCode })}
              value={codeSize}
            />
          }
        />
      </SettingsSection>
    </div>
  );
}
