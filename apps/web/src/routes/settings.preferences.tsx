import { createFileRoute } from "@tanstack/react-router";
import { SlidersHorizontalIcon } from "lucide-react";

import { SettingsEmptyPage } from "../components/mercurian/SettingsEmptyPage";

function SettingsPreferencesRoute() {
  return (
    <SettingsEmptyPage
      icon={SlidersHorizontalIcon}
      title="No preferences yet"
      description="Coding-session preferences live here: whether a new worktree starts from the repository’s latest branch on origin or from your local one, how often remote status is refreshed in the background, and the confirmations before a plan is archived or deleted."
    />
  );
}

export const Route = createFileRoute("/settings/preferences")({
  component: SettingsPreferencesRoute,
});
