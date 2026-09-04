/** Owned by the panel lane of M-197 (plan §6). Fills the right-panel surface slots of ChatView for a plan line. */
import type { ReactNode } from "react";

import { useThreadSpace } from "./ThreadSpaceContext";

export type ThreadSpaceSurfaces = Readonly<{
  planPanel?: ReactNode;
  specPanel?: ReactNode;
  checkpointsPanel?: ReactNode;
}>;

const EMPTY_SURFACES: ThreadSpaceSurfaces = {};

export function useThreadSpaceSurfaces(): ThreadSpaceSurfaces {
  useThreadSpace();
  return EMPTY_SURFACES;
}
