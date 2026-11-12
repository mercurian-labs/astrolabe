import { createFileRoute } from "@tanstack/react-router";
import { ProjectsSettings } from "../components/settings/ProjectsSettings";

export const Route = createFileRoute("/_chat/settings/projects")({
  // The language server a file's header sent someone to ask about.
  validateSearch: (search: Record<string, unknown>): { server?: string } =>
    typeof search.server === "string" ? { server: search.server } : {},
  component: ProjectsSettings,
});
