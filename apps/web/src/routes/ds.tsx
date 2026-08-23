import { createFileRoute } from "@tanstack/react-router";

export type DesignSystemRouteSearch = Readonly<{
  page?: string;
  entry?: string;
}>;

export function validateDesignSystemSearch(
  search: Record<string, unknown>,
): DesignSystemRouteSearch {
  return {
    ...(typeof search.page === "string" ? { page: search.page } : {}),
    ...(typeof search.entry === "string" ? { entry: search.entry } : {}),
  };
}

export const Route = createFileRoute("/ds")({
  validateSearch: validateDesignSystemSearch,
});
