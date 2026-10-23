import { LayersIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useChangeGroups } from "~/state/changeGroups";
import { parseChangeGroupTabKey } from "./changeGroupTabs";

/** A change group tab's title and icon; null for any other key. */
export function useChangeGroupTabLabel(key: string): { title: string; icon: ReactNode } | null {
  const groups = useChangeGroups();
  const tab = parseChangeGroupTabKey(key);
  if (tab === null) return null;
  const group = groups.find(
    (candidate) =>
      candidate.environmentId === tab.environmentId && candidate.groupId === tab.groupId,
  );
  return {
    title: group?.title ?? "Change group",
    icon: <LayersIcon className="size-3.5 shrink-0" />,
  };
}
