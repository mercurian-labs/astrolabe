import { PlanId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { PlanningSpace } from "../components/mercurian/PlanningSpace";

function PlanRouteView() {
  const { planId } = Route.useParams();
  return <PlanningSpace planId={PlanId.make(planId)} />;
}

export const Route = createFileRoute("/_chat/plans/$planId")({
  component: PlanRouteView,
});
