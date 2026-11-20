import { UserRoundIcon, UsersIcon } from "lucide-react";

import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import { useSelectedWorkspace } from "./workspaces/useSelectedWorkspace";
import { WorkspaceTile } from "./workspaces/WorkspaceTile";

export const SWITCH_WORKSPACE_GROUP = "workspaces";

const CURRENT = <span className="text-xs text-muted-foreground/70">Current</span>;

/** Switch workspace, as the rail's switcher offers it; null until the person is in one. */
export function useCommandPaletteWorkspaceItem(): CommandPaletteSubmenuItem | null {
  const state = useSelectedWorkspace();
  if (state.status !== "ready" || state.memberships.length === 0) return null;
  const selectedId = state.selected?.workspace.id ?? null;

  const items: CommandPaletteActionItem[] = state.memberships.map(({ workspace }) => ({
    kind: "action",
    value: `workspace:${workspace.id}`,
    title: workspace.name,
    searchTerms: [workspace.name, workspace.slug, "workspace"],
    icon: <WorkspaceTile workspace={workspace} />,
    titleTrailingContent: workspace.id === selectedId ? CURRENT : undefined,
    run: async () => state.select(workspace.id),
  }));
  items.push({
    kind: "action",
    value: "workspace:personal",
    title: "Personal",
    searchTerms: ["personal", "no workspace", "none"],
    icon: <UserRoundIcon className={ITEM_ICON_CLASS} />,
    titleTrailingContent: selectedId === null ? CURRENT : undefined,
    run: async () => state.select(null),
  });

  return {
    kind: "submenu",
    value: "action:switch-workspace",
    searchTerms: ["switch workspace", "change workspace", "workspace", "organization", "org"],
    title: "Switch workspace",
    icon: <UsersIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <UsersIcon className={ADDON_ICON_CLASS} />,
    groups: [{ value: SWITCH_WORKSPACE_GROUP, label: "Switch workspace", items }],
  };
}
