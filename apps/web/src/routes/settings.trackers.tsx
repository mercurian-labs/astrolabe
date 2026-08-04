import { createFileRoute } from "@tanstack/react-router";
import { CircleDotIcon } from "lucide-react";

import { SettingsEmptyPage } from "../components/mercurian/SettingsEmptyPage";

function SettingsTrackersRoute() {
  return (
    <SettingsEmptyPage
      icon={CircleDotIcon}
      title="No trackers connected"
      description="Connections to external issue trackers are made and managed here. The issues themselves never arrive through Settings — they enter as the starting points of plans, through import."
    />
  );
}

export const Route = createFileRoute("/settings/trackers")({
  component: SettingsTrackersRoute,
});
