import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The work-surface layout: an auth gate and an outlet.
 *
 * The thread keybinding plumbing that used to live here left with the routes
 * that gave it meaning. `sidebar.toggle` still works — it lives in
 * `AppSidebarLayout` — while the `chat.*` bindings are inert until coding
 * sessions re-earn them.
 */
function ChatRouteLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
