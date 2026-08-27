import { createFileRoute, redirect } from "@tanstack/react-router";

import { ExperimentsSettings } from "../components/mercurian/ExperimentsSettings";

export const Route = createFileRoute("/settings/experiments")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ExperimentsSettings,
});
