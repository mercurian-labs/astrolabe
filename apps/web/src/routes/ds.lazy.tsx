import { createLazyFileRoute } from "@tanstack/react-router";

import { DesignSystemLayout } from "../components/design-system/DesignSystemLayout";

export const Route = createLazyFileRoute("/ds")({
  component: DesignSystemRoute,
});

function DesignSystemRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <DesignSystemLayout
      onSearchChange={(next) => void navigate({ search: next })}
      search={search}
    />
  );
}
