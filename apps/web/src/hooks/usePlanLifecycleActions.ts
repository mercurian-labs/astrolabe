import type { PlanId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { mercurianPlanning } from "../state/mercurian";
import {
  useEnvironmentBoundCommandResult,
  type EnvironmentBoundCommandResult,
} from "../state/useEnvironmentBoundCommand";

/**
 * The three ways a plan leaves the tree, from wherever a plan is listed.
 *
 * Shaped after `useThreadActions`: perform, toast the refusal, and get out of
 * the way when the plan you just acted on is the one on screen. Two of the
 * three are reversible — archiving and restoring are the same door — and the
 * third only exists while the plan is fully private, which the caller decides
 * with `buildPlanRowMenuItems` before ever offering it.
 *
 * The refusals are surfaced rather than swallowed, which is why these bind
 * through `useEnvironmentBoundCommandResult`: a delete that lost the race
 * against a publish comes back as `PlanDeleteBlockedError`, and its own message
 * is the one worth showing.
 *
 * Nothing here refreshes a listing. The tree is one live subscription, so the
 * row leaves (or returns) in every window as the server announces the change.
 */
export function usePlanLifecycleActions() {
  const router = useRouter();
  const runArchive = useEnvironmentBoundCommandResult(mercurianPlanning.archivePlan);
  const runUnarchive = useEnvironmentBoundCommandResult(mercurianPlanning.unarchivePlan);
  const runDelete = useEnvironmentBoundCommandResult(mercurianPlanning.deletePlan);

  /**
   * Whether the plan being acted on is the one the route is showing. Archiving
   * or deleting it has to move somewhere first: the tree is the fallback, and
   * for a delete the URL would otherwise dead-end on a plan that is gone.
   */
  const isPlanOpen = useCallback(
    (planId: PlanId) =>
      router.state.matches.some((match) => {
        const params = match.params as { readonly planId?: string };
        return params.planId === planId;
      }),
    [router],
  );

  const perform = useCallback(
    async (input: {
      readonly planId: PlanId;
      readonly run: (value: { planId: PlanId }) => Promise<EnvironmentBoundCommandResult<unknown>>;
      readonly failureTitle: string;
      readonly leavesTheRoute: boolean;
    }) => {
      // Navigate before the act when it removes what the route is showing: a
      // deleted plan's subscription would otherwise refuse mid-render.
      if (input.leavesTheRoute && isPlanOpen(input.planId)) {
        await router.navigate({ to: "/", replace: true });
      }
      const result = await input.run({ planId: input.planId });
      if (result.ok) {
        return true;
      }
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: input.failureTitle,
          description: result.error instanceof Error ? result.error.message : "An error occurred.",
        }),
      );
      return false;
    },
    [isPlanOpen, router],
  );

  const archivePlan = useCallback(
    (planId: PlanId) =>
      perform({
        planId,
        run: runArchive,
        failureTitle: "Failed to archive plan",
        leavesTheRoute: true,
      }),
    [perform, runArchive],
  );

  /** Restore, as the Archived page names it. The plan returns to its project. */
  const unarchivePlan = useCallback(
    (planId: PlanId) =>
      perform({
        planId,
        run: runUnarchive,
        failureTitle: "Failed to restore plan",
        leavesTheRoute: false,
      }),
    [perform, runUnarchive],
  );

  const deletePlan = useCallback(
    (planId: PlanId) =>
      perform({
        planId,
        run: runDelete,
        failureTitle: "Failed to delete plan",
        leavesTheRoute: true,
      }),
    [perform, runDelete],
  );

  return useMemo(
    () => ({ archivePlan, unarchivePlan, deletePlan }),
    [archivePlan, deletePlan, unarchivePlan],
  );
}
