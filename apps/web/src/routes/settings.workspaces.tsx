import { createFileRoute } from "@tanstack/react-router";

import { WorkspacesSettings } from "../components/workspaces/WorkspacesSettings";

export const Route = createFileRoute("/settings/workspaces")({
  // The selected workspace, by its short name.
  validateSearch: (search: Record<string, unknown>): { w?: string } =>
    typeof search.w === "string" ? { w: search.w } : {},
  component: WorkspacesSettings,
});
