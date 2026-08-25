import { useDesignLabOverridesStore } from "../../designLabOverrides";
import { useTheme } from "../../hooks/useTheme";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import {
  toggleThemeEditorForTheme,
  useThemeEditorStore,
} from "../../components/settings/themeEditorStore";
import { Button } from "../../components/ui/button";

export function AxisColorPage() {
  const session = useThemeEditorStore((store) => store.session);
  const closeThemeEditor = useThemeEditorStore((store) => store.closeThemeEditor);
  const setThemeEditorSlot = useDesignLabOverridesStore((store) => store.setThemeEditorSlot);
  const { resolvedTheme, theme, themeHalves } = useTheme();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:px-8">
      <SettingsSection
        title="Color"
        headerAction={
          <Button disabled={!session} onClick={closeThemeEditor} size="xs" variant="outline">
            Reset axis
          </Button>
        }
      >
        <SettingsRow
          title="Live theme draft"
          description="Edit both appearance halves against the real application. The same draft follows you when you leave this page."
          control={
            session ? null : (
              <Button
                onClick={() =>
                  toggleThemeEditorForTheme({
                    theme,
                    themeHalves,
                    initialAppearance: resolvedTheme,
                  })
                }
                size="sm"
              >
                Edit the current theme
              </Button>
            )
          }
        />
        <div className="px-3 pb-3 sm:px-4">
          <div
            className="min-h-48 rounded-xl border border-dashed border-border bg-background/50 p-2"
            ref={setThemeEditorSlot}
          >
            {session ? null : (
              <p className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
                Start a draft to dock the theme editor here.
              </p>
            )}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
