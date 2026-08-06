import { createFileRoute } from "@tanstack/react-router";

import { TrackersSettings } from "../components/settings/TrackersSettings";

export const Route = createFileRoute("/settings/trackers")({
  component: TrackersSettings,
});
