import { createFileRoute } from "@tanstack/react-router";

/**
 * Astrolabe: the Repositories section. Its files and changes open as tabs of the shared panes,
 * which the `_chat` layout renders; the route only says the sidebar lists repositories.
 */
export const Route = createFileRoute("/_chat/repositories")({
  component: () => null,
});
