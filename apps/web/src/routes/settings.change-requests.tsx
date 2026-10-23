import { createFileRoute } from "@tanstack/react-router";

import { ChangeRequestSettingsPanel } from "../components/settings/ChangeRequestSettings";

export const Route = createFileRoute("/settings/change-requests")({
  component: ChangeRequestSettingsPanel,
});
