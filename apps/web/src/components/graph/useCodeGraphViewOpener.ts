import type { ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { codeGraphViewsAtom, codeGraphViewsKey, NO_CODE_GRAPH_VIEWS } from "~/state/codeGraphViews";
import { showThreadGraphView } from "./threadGraphStore";

/**
 * Astrolabe: opens the thread's Graph tab on a view an agent shows while the thread is open. The
 * views the thread held when it loaded are history: they wait in the tab's view menu.
 */
export function useCodeGraphViewOpener(threadRef: ScopedThreadRef | null) {
  const key = threadRef === null ? "" : codeGraphViewsKey(threadRef);
  const views = useAtomValue(threadRef === null ? NO_CODE_GRAPH_VIEWS : codeGraphViewsAtom(key));
  const latest = views === null ? null : (views.at(-1)?.id ?? "");
  const seen = useRef<{ readonly key: string; readonly latest: string } | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- opens a right-panel surface when a tool call lands
  useEffect(() => {
    if (threadRef === null || latest === null) return;
    const before = seen.current;
    seen.current = { key, latest };
    if (before === null || before.key !== key || before.latest === latest || latest === "") return;
    showThreadGraphView(key, latest);
    useRightPanelStore.getState().open(threadRef, "graph");
  }, [key, latest, threadRef]);
}
