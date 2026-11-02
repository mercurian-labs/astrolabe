import { codeGraphViews, type CodeGraphView } from "@t3tools/client-runtime/codeGraphViews";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "./threads";

/**
 * Astrolabe: a thread's code graph views (`codeGraphViews`), from its structure, which holds
 * through streamed text; null until the thread has loaded. A read with the same views keeps the
 * same array, so the Graph tab redraws only when a view lands.
 */
export const codeGraphViewsAtom = Atom.family((key: string) => {
  const [environmentId, threadId] = JSON.parse(key) as [EnvironmentId, ThreadId];
  let last: { readonly key: string; readonly views: ReadonlyArray<CodeGraphView> } | null = null;
  return Atom.make((get): ReadonlyArray<CodeGraphView> | null => {
    const thread = get(environmentThreadDetails.quietThreadAtom({ environmentId, threadId }));
    if (thread === null) return null;
    const views = codeGraphViews(thread.projection.turnItems);
    const viewsKey = JSON.stringify(views);
    if (last?.key === viewsKey) return last.views;
    last = { key: viewsKey, views };
    return views;
  }).pipe(Atom.withLabel(`web-code-graph:views:${key}`));
});

/** No thread: no views, and nothing read. */
export const NO_CODE_GRAPH_VIEWS = Atom.make<ReadonlyArray<CodeGraphView> | null>(null).pipe(
  Atom.withLabel("web-code-graph:views:none"),
);

export const codeGraphViewsKey = (ref: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) => JSON.stringify([ref.environmentId, ref.threadId]);
