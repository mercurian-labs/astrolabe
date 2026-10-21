import { createFileRoute } from "@tanstack/react-router";

import { WikiWorkspace } from "../components/wiki/WikiWorkspace";

export const Route = createFileRoute("/_chat/wikis")({
  component: WikisRouteView,
});

function WikisRouteView() {
  return <WikiWorkspace deepLink={null} />;
}
