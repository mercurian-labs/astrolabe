import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function PlanRouteRedirect() {
  const navigate = useNavigate();
  const { planId } = Route.useParams();

  useEffect(() => {
    void navigate({ to: "/threads/$planId", params: { planId }, search: true, replace: true });
  }, [navigate, planId]);

  return null;
}

export const Route = createFileRoute("/_chat/plans/$planId")({
  component: PlanRouteRedirect,
});
