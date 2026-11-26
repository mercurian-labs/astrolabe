import { createFileRoute } from "@tanstack/react-router";

// Wikis became Projects' folders; the settings route redirects old links to /settings/projects.
export const Route = createFileRoute("/_chat/settings/wikis")({});
