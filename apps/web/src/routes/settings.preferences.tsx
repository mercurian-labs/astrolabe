import { createFileRoute } from "@tanstack/react-router";

import { PreferencesSettings } from "../components/mercurian/PreferencesSettings";

function SettingsPreferencesRoute() {
  return <PreferencesSettings />;
}

export const Route = createFileRoute("/settings/preferences")({
  component: SettingsPreferencesRoute,
});
