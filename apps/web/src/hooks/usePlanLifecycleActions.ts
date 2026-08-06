import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PlanId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { mercurianPlanning } from "../state/mercurian";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * The three ways a plan leaves the tree, from wherever a plan is listed.
 *
 * Shaped after `useThreadActions`: perform, toast the refusal, and get out of
 * the way when the plan you just acted on is the one on screen. Two of the
 * three are reversible — archiving and restoring are the same door — and the
 * third only exists while the plan is fully private, which the caller decides
 * with `resolvePlanRowActions` before ever offering it.
 *
 * Nothing here refreshes a listing. The tree is one live subscription, so the
 * row leaves (or returns) in every window as the server announces the change.
 */
export function usePlanLifecycleActions() {
  const environmentId = usePrimaryEnvironmentId();
  const router = useRouter();
  const archivePlanCommand = useAtomCommand(mercurianPlanning.archivePlan, {
    reportFailure: false,
  });
  const unarchivePlanCommand = useAtomCommand(mercurianPlanning.unarchivePlan, {
    reportFailure: false,
  });
  const deletePlanCommand = useAtomCommand(mercurianPlanning.deletePlan, {
    reportFailure: false,
  });

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
      readonly run: (value: {
        environmentId: EnvironmentId;
        input: { planId: PlanId };
      }) => Promise<AtomCommandResult<unknown, unknown>>;
      readonly failureTitle: string;
      readonly leavesTheRoute: boolean;
    }) => {
      if (environmentId === null) {
        return false;
      }
      // Navigate before the act when it removes what the route is showing: a
      // deleted plan's subscription would otherwise refuse mid-render.
      if (input.leavesTheRoute && isPlanOpen(input.planId)) {
        await router.navigate({ to: "/", replace: true });
      }
      const result = await input.run({ environmentId, input: { planId: input.planId } });
      if (result._tag === "Success") {
        return true;
      }
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: input.failureTitle,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      return false;
    },
    [environmentId, isPlanOpen, router],
  );

  const archivePlan = useCallback(
    (planId: PlanId) =>
      perform({
        planId,
        run: archivePlanCommand,
        failureTitle: "Failed to archive plan",
        leavesTheRoute: true,
      }),
    [archivePlanCommand, perform],
  );

  /** Restore, as the Archived page names it. The plan returns to its project. */
  const unarchivePlan = useCallback(
    (planId: PlanId) =>
      perform({
        planId,
        run: unarchivePlanCommand,
        failureTitle: "Failed to restore plan",
        leavesTheRoute: false,
      }),
    [perform, unarchivePlanCommand],
  );

  const deletePlan = useCallback(
    (planId: PlanId) =>
      perform({
        planId,
        run: deletePlanCommand,
        failureTitle: "Failed to delete plan",
        leavesTheRoute: true,
      }),
    [deletePlanCommand, perform],
  );

  return useMemo(
    () => ({ archivePlan, unarchivePlan, deletePlan }),
    [archivePlan, deletePlan, unarchivePlan],
  );
}
