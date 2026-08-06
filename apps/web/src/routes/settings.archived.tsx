import { createFileRoute } from "@tanstack/react-router";

import { ArchivedPlansPanel } from "../components/mercurian/ArchivedPlansPanel";

export const Route = createFileRoute("/settings/archived")({
  component: ArchivedPlansPanel,
});
