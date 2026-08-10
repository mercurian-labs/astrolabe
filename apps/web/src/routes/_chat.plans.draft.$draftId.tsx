import { createFileRoute } from "@tanstack/react-router";

import { PlanningSpaceDraft } from "../components/mercurian/PlanningSpace";

/**
 * The static `draft` segment wins over `$planId`, so an unborn plan gets its
 * own address without shadowing real plans.
 */
function PlanDraftRouteView() {
  const { draftId } = Route.useParams();
  return <PlanningSpaceDraft draftId={draftId} />;
}

export const Route = createFileRoute("/_chat/plans/draft/$draftId")({
  component: PlanDraftRouteView,
});
