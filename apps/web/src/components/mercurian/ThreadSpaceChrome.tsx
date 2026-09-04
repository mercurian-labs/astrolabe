/** Owned by the header lane of M-197 (plan §7). Header actions, banners, and the overlays that wrap ChatView for a plan line. */
import type { MessageId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { useThreadSpace } from "./ThreadSpaceContext";

export type ThreadSpaceChatViewChrome = Readonly<{
  headerLeadingActions?: ReactNode;
  headerBanner?: ReactNode;
  workspaceReady?: boolean;
  onForkHere?: (messageId: MessageId) => void;
}>;

export type ThreadSpaceChrome = Readonly<{
  chatView: ThreadSpaceChatViewChrome;
  overlays?: ReactNode;
}>;

const EMPTY_CHROME: ThreadSpaceChrome = { chatView: {} };

export function useThreadSpaceChrome(): ThreadSpaceChrome {
  useThreadSpace();
  return EMPTY_CHROME;
}
