import { createFileRoute } from "@tanstack/react-router";

/**
 * Astrolabe: the Wikis section. Its documents open as tabs of the shared panes, which the
 * `_chat` layout renders; the route only says the sidebar lists wikis.
 */
export const Route = createFileRoute("/_chat/wikis")({
  component: () => null,
});
