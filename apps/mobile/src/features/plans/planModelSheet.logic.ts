import { providerLabel } from "@t3tools/client-runtime/state/plan-composer";
import type { PlanningModelSelection, ServerProvider } from "@t3tools/contracts";

export interface PlanModelOption {
  readonly key: string;
  readonly selection: PlanningModelSelection;
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly signedIn: boolean;
  readonly injected: boolean;
}

const keyFor = (selection: PlanningModelSelection) =>
  `${selection.provider}\u0000${selection.model}`;

export function planModelOptions(
  providers: ReadonlyArray<ServerProvider>,
  standing: PlanningModelSelection | null,
): ReadonlyArray<PlanModelOption> {
  const byKey = new Map<string, PlanModelOption>();
  for (const provider of providers) {
    for (const model of provider.models) {
      const selection = { provider: provider.driver, model: model.slug };
      const key = keyFor(selection);
      const existing = byKey.get(key);
      byKey.set(key, {
        key,
        selection,
        providerLabel: providerLabel(provider.driver),
        modelLabel: existing?.modelLabel ?? model.name,
        signedIn: (existing?.signedIn ?? false) || provider.auth.status !== "unauthenticated",
        injected: false,
      });
    }
  }
  if (standing !== null && !byKey.has(keyFor(standing))) {
    const key = keyFor(standing);
    byKey.set(key, {
      key,
      selection: standing,
      providerLabel: providerLabel(standing.provider),
      modelLabel: standing.model,
      signedIn: false,
      injected: true,
    });
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.providerLabel.localeCompare(right.providerLabel) ||
      left.modelLabel.localeCompare(right.modelLabel),
  );
}
