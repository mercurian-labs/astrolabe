import { createFileRoute, redirect } from "@tanstack/react-router";

/** Astrolabe: the old Wikis section, kept for one release: its documents live in Projects now. */
export const Route = createFileRoute("/_chat/wikis")({
  beforeLoad: () => {
    throw redirect({ to: "/repositories", replace: true });
  },
});
