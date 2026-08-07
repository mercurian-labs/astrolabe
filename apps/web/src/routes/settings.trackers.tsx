import { createFileRoute } from "@tanstack/react-router";

import { TrackersSettings } from "../components/mercurian/TrackersSettings";

export const Route = createFileRoute("/settings/trackers")({
  component: TrackersSettings,
});
