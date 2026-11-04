import { canvasViews, type CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "./threads";

/**
 * Astrolabe: a thread's canvases (`canvasViews`), from its structure, which holds through
 * streamed text. A read with the same canvases keeps the same array.
 */
export const canvasViewsAtom = Atom.family((key: string) => {
  const [environmentId, threadId] = JSON.parse(key) as [EnvironmentId, ThreadId];
  let last: ReadonlyArray<CanvasView & { readonly id: string }> = [];
  return Atom.make((get) => {
    const thread = get(environmentThreadDetails.quietThreadAtom({ environmentId, threadId }));
    if (thread === null) return last;
    const views = canvasViews(thread.projection.turnItems);
    const same =
      views.length === last.length && views.every((view, index) => view.id === last[index]?.id);
    if (!same) last = views;
    return last;
  }).pipe(Atom.withLabel(`web-canvas:views:${key}`));
});

export const canvasViewsKey = (ref: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) => JSON.stringify([ref.environmentId, ref.threadId]);
