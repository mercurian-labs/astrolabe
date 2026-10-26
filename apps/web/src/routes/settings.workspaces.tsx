import { createFileRoute, redirect } from "@tanstack/react-router";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { WorkspacesSettings } from "../components/workspaces/WorkspacesSettings";

export const Route = createFileRoute("/settings/workspaces")({
  // The selected workspace, by its short name.
  validateSearch: (search: Record<string, unknown>): { w?: string } =>
    typeof search.w === "string" ? { w: search.w } : {},
  // Workspaces need Astrolabe sign-in; without cloud config the section is hidden.
  beforeLoad: () => {
    if (!hasCloudPublicConfig()) throw redirect({ to: "/settings/general", replace: true });
  },
  component: WorkspacesSettings,
});
