import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect } from "react";

import { useTheme } from "../../hooks/useTheme";
import { resolveShortcutCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { getThemeDefinition, type ThemeAppearance, type ThemeDefinition } from "../../themePalette";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ThemeEditorPanel } from "./ThemeEditorPanel";
import { toggleThemeEditorForTheme, useThemeEditorStore } from "./themeEditorStore";

/**
 * Renders the theme editor above the router. The editor paints its draft on
 * the live app, so it has to outlive the settings route: the point is to walk
 * through threads, panels, and pages while the colors are being tuned.
 */
export function ThemeEditorHost() {
  const session = useThemeEditorStore((store) => store.session);
  const closeThemeEditor = useThemeEditorStore((store) => store.closeThemeEditor);
  const { theme, setTheme, themeHalves, refreshTheme, resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  // The editor owns its own chord. It used to ride the command palette's
  // listener, which made a live feature a tenant of a surface it has nothing
  // to do with.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (resolveShortcutCommand(event, keybindings) !== "themeEditor.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      toggleThemeEditorForTheme({ theme, themeHalves, initialAppearance: resolvedTheme });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, resolvedTheme, theme, themeHalves]);

  // The panel reports which path it actually took: a theme removed while its
  // editor is open resolves to null there, so the save becomes a create even
  // though the session still names it.
  const handleSaved = useCallback(
    (
      savedTheme: ThemeDefinition,
      { created, mergedAppearance }: { created: boolean; mergedAppearance?: ThemeAppearance },
    ) => {
      // A merge completed an existing theme's light/dark pair; activating the
      // whole theme shows the new palette right away.
      if (mergedAppearance) {
        if (!setTheme(savedTheme.id)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not save your theme",
              description: "Browser storage is unavailable, so the change was not kept.",
            }),
          );
          return false;
        }
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: `${savedTheme.label} updated`,
            description: `Its ${mergedAppearance} palette was added.`,
          }),
        );
        return true;
      }
      if (!created) {
        // The edited theme may be showing through the base preference or either
        // half of the mix; the preference itself is untouched (a setTheme here
        // would clear the mix), the palette just needs re-applying.
        const wasActive =
          getThemeDefinition(theme)?.id === savedTheme.id ||
          themeHalves?.light === savedTheme.id ||
          themeHalves?.dark === savedTheme.id;
        if (wasActive) refreshTheme();
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: `${savedTheme.label} saved`,
            description: wasActive ? "Your changes are now active." : "Your changes are saved.",
          }),
        );
        return true;
      }

      if (!setTheme(savedTheme.id)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not save your theme",
            description: "Browser storage is unavailable, so the change was not kept.",
          }),
        );
        return false;
      }
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `${savedTheme.label} created`,
          description: "It’s now active.",
        }),
      );
      return true;
    },
    [refreshTheme, setTheme, theme, themeHalves],
  );

  if (!session) return null;

  // Resolve on every render: an edit or import can change the stored
  // definitions while a session is open.
  const editingTheme = session.editingThemeId
    ? (getThemeDefinition(session.editingThemeId) ?? null)
    : null;
  const seedTheme = session.seedThemeId ? (getThemeDefinition(session.seedThemeId) ?? null) : null;

  return (
    <ThemeEditorPanel
      editingTheme={editingTheme}
      initialAppearance={session.initialAppearance}
      key={session.id}
      onOpenChange={(open) => {
        if (!open) closeThemeEditor();
      }}
      onSaved={handleSaved}
      open
      restoreTheme={refreshTheme}
      seedName={session.seedName ?? undefined}
      seedTheme={seedTheme}
    />
  );
}
