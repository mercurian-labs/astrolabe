import type { MemoryComparisonResult, MemoryComparisonSelection } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { mercurianMemory } from "../../state/mercurianMemory";
import { useEnvironmentBoundCommandResult } from "../../state/useEnvironmentBoundCommand";

export type MemoryComparisonReadState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly result: MemoryComparisonResult };

/**
 * Reads one immutable memory comparison for the shared Diff panel. The two
 * trees are pinned in the selection, so nothing here refreshes or polls.
 */
export function useMemoryComparisonRead(
  selection: MemoryComparisonSelection | null,
): MemoryComparisonReadState {
  const readComparison = useEnvironmentBoundCommandResult(
    mercurianMemory.readMemoryComparison,
    selection?.environmentId ?? null,
  );
  const [state, setState] = useState<{
    readonly target: MemoryComparisonSelection["target"] | null;
    readonly value: MemoryComparisonReadState;
  }>({ target: null, value: { kind: "idle" } });
  const target = selection?.target ?? null;
  useEffect(() => {
    if (target === null) return;
    let active = true;
    void readComparison({ target }).then((outcome) => {
      if (!active) return;
      setState({
        target,
        value: outcome.ok
          ? { kind: "ready", result: outcome.value }
          : {
              kind: "error",
              message:
                outcome.error instanceof Error
                  ? outcome.error.message
                  : "Could not read this memory comparison.",
            },
      });
    });
    return () => {
      active = false;
    };
  }, [readComparison, target]);
  return target === null
    ? { kind: "idle" }
    : state.target === target
      ? state.value
      : { kind: "loading" };
}

type MemoryMapComparison = Extract<
  MemoryComparisonResult,
  { readonly kind: "available" }
>["maps"][number];

const mapSideLabel = (side: MemoryMapComparison["before"]) =>
  side === null
    ? "absent"
    : "refusal" in side
      ? `unreadable (${side.refusal})`
      : `${side.edges.length} edges`;

/** Skill-map changes stay reviewable as structure, body, and the raw patch below. */
export function MemoryMapComparisonSummary({
  maps,
}: {
  readonly maps: ReadonlyArray<MemoryMapComparison>;
}) {
  if (maps.length === 0) return null;
  return (
    <ul className="shrink-0 space-y-1 border-b border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
      {maps.map((map) => (
        <li key={map.path}>
          <span className="font-medium text-foreground">{map.path}</span>
          {" · structure "}
          {map.structureChanged ? "changed" : "unchanged"}
          {" · teaching body "}
          {map.bodyChanged ? "changed" : "unchanged"}
          {" · before: "}
          {mapSideLabel(map.before)}
          {" · after: "}
          {mapSideLabel(map.after)}
        </li>
      ))}
    </ul>
  );
}
