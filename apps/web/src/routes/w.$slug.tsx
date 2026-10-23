import { createFileRoute, redirect } from "@tanstack/react-router";

/** A workspace's address, /w/<short name>, opens it in Settings › Workspaces. */
export const Route = createFileRoute("/w/$slug")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/settings/workspaces", search: { w: params.slug }, replace: true });
  },
});
