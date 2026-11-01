import { canInvite } from "@t3tools/client-runtime/workspaces";
import { useNavigate } from "@tanstack/react-router";
import { LogInIcon, PlusIcon, SettingsIcon, UserPlusIcon } from "lucide-react";

import { startCloudSignIn } from "../../cloud/account";
import { AstrolabeMarkSmall } from "../brand/AstrolabeMarks";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSelectedWorkspace } from "../workspaces/useSelectedWorkspace";
import { WorkspaceTile } from "../workspaces/WorkspaceTile";

// The radio value for "no workspace"; workspace ids are never empty.
const NO_WORKSPACE = "";

/** The rail's mark, on a tile as large as a rail button's square, so it heads their column. */
export function RailMarkTile() {
  return (
    <span
      data-app-rail-mark=""
      className="flex size-8 items-center justify-center rounded-md border border-border bg-background shadow-xs/5"
    >
      <AstrolabeMarkSmall className="h-5" />
    </span>
  );
}

/**
 * The rail's head where sign-in is set up: the selected workspace's tile, or the mark when none
 * is, opening a menu to switch. Render it only when `hasCloudPublicConfig()`.
 */
export function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const state = useSelectedWorkspace();
  const selected = state.status === "ready" ? state.selected : null;
  const name = selected?.workspace.name;

  const openSettings = (hash?: string) =>
    void navigate({
      to: "/settings/workspaces",
      search: selected ? { w: selected.workspace.slug } : {},
      ...(hash ? { hash, hashScrollIntoView: false } : {}),
    });

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  data-app-rail-switcher=""
                  aria-label={name ? `Workspace: ${name}` : "Workspaces"}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  {selected ? (
                    <WorkspaceTile workspace={selected.workspace} className="size-8" />
                  ) : (
                    <RailMarkTile />
                  )}
                </button>
              }
            />
          }
        />
        <TooltipPopup side="right">{name ?? "Workspaces"}</TooltipPopup>
      </Tooltip>
      <MenuPopup side="right" align="start" className="min-w-56">
        {state.status === "signedOut" ? (
          <MenuItem onClick={startCloudSignIn}>
            <LogInIcon />
            Sign in
          </MenuItem>
        ) : state.status === "loading" ? (
          <MenuItem disabled>Loading workspaces…</MenuItem>
        ) : (
          <>
            <MenuGroup>
              <MenuGroupLabel>Workspaces</MenuGroupLabel>
              <MenuRadioGroup
                value={selected?.workspace.id ?? NO_WORKSPACE}
                onValueChange={(id) => {
                  if (typeof id === "string") state.select(id === NO_WORKSPACE ? null : id);
                }}
              >
                {state.memberships.map(({ workspace }) => (
                  <MenuRadioItem key={workspace.id} value={workspace.id} closeOnClick>
                    <span className="flex min-w-0 items-center gap-2">
                      <WorkspaceTile workspace={workspace} />
                      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                      <MenuRadioItemIndicator />
                    </span>
                  </MenuRadioItem>
                ))}
                <MenuRadioItem value={NO_WORKSPACE} closeOnClick>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">No workspace</span>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            {selected && canInvite(selected.myRole, selected.workspace) ? (
              <MenuItem onClick={() => openSettings("workspace-people")}>
                <UserPlusIcon />
                Invite people
              </MenuItem>
            ) : null}
            <MenuItem onClick={() => openSettings()}>
              <SettingsIcon />
              Workspace settings
            </MenuItem>
            {state.canStartWorkspace ? (
              <MenuItem onClick={() => openSettings("workspace-new")}>
                <PlusIcon />
                Create workspace
              </MenuItem>
            ) : null}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}
