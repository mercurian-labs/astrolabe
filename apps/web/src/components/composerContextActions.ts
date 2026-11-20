import type { CanvasContextRecord, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createContext, type MouseEvent } from "react";

export interface ComposerContextActions {
  environmentId: EnvironmentId | null;
  cwd?: string | undefined;
  projectId?: ProjectId | undefined;
  expandImage: (imageId: string) => void;
  expandVideo: (fileId: string) => void;
  openFile: (fileId: string) => void;
  openMention: (path: string) => void;
  openPullRequest: (event: MouseEvent<HTMLElement>, url: string) => void;
  openCanvas: (itemId: CanvasContextRecord["itemId"]) => void;
  commentOnCanvas: (contextId: CanvasContextRecord["contextId"], comment: string) => void;
}

export const ComposerContextActionsContext = createContext<ComposerContextActions>({
  environmentId: null,
  expandImage: () => {},
  expandVideo: () => {},
  openFile: () => {},
  openMention: () => {},
  openPullRequest: () => {},
  openCanvas: () => {},
  commentOnCanvas: () => {},
});
