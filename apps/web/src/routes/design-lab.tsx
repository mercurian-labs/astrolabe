import { createFileRoute, redirect } from "@tanstack/react-router";

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

export const Route = createFileRoute("/design-lab")({
  beforeLoad: async ({ context }) => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }

    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: validateDesignSystemSearch,
});
