import { canInvite } from "@t3tools/client-runtime/workspaces";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  LogInIcon,
  PlusIcon,
  SettingsIcon,
  UserPlusIcon,
  UserRoundIcon,
} from "lucide-react";

import { startCloudSignIn } from "../../cloud/account";
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

// The radio value for Personal; workspace ids are never empty.
const PERSONAL = "";

/**
 * Personal (no workspace) on a tile as large as a rail button's square. A plain person glyph, not
 * the avatar, which the account menu at the rail's foot already shows.
 */
export function PersonalTile() {
  return (
    <span
      data-app-rail-personal=""
      className="flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-xs/5"
    >
      <UserRoundIcon className="size-4" />
    </span>
  );
}

/**
 * The rail's head where sign-in is set up: the selected workspace's tile, or Personal when none
 * is, opening a menu to switch. In the narrow sidebar's title row (`inHeader`), the tile carries
 * the name too, as the rail's tooltip would. Render it only when `hasCloudPublicConfig()`.
 */
export function WorkspaceSwitcher({
  inHeader = false,
  onNavigate,
}: {
  readonly inHeader?: boolean;
  /** Called before a menu item opens Settings, so the narrow sidebar can close over it. */
  readonly onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const state = useSelectedWorkspace();
  const selected = state.status === "ready" ? state.selected : null;
  const name = selected?.workspace.name ?? "Personal";

  const openSettings = (hash?: string) => {
    onNavigate?.();
    void navigate({
      to: "/settings/workspaces",
      search: selected ? { w: selected.workspace.slug } : {},
      ...(hash ? { hash, hashScrollIntoView: false } : {}),
    });
  };

  const tile = selected ? (
    <WorkspaceTile workspace={selected.workspace} className={inHeader ? "size-6" : "size-8"} />
  ) : inHeader ? (
    <UserRoundIcon className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <PersonalTile />
  );

  return (
    <Menu>
      {inHeader ? (
        <MenuTrigger
          render={
            <button
              type="button"
              data-sidebar-workspace-switcher=""
              aria-label={`Workspace: ${name}`}
              className="flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              {tile}
              <span className="min-w-0 truncate">{name}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          }
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <button
                    type="button"
                    data-app-rail-switcher=""
                    aria-label={`Workspace: ${name}`}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    {tile}
                  </button>
                }
              />
            }
          />
          <TooltipPopup side="right">{name}</TooltipPopup>
        </Tooltip>
      )}
      <MenuPopup side={inHeader ? "bottom" : "right"} align="start" className="min-w-56">
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
                value={selected?.workspace.id ?? PERSONAL}
                onValueChange={(id) => {
                  if (typeof id === "string") state.select(id === PERSONAL ? null : id);
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
                <MenuRadioItem value={PERSONAL} closeOnClick>
                  <span className="flex min-w-0 items-center gap-2">
                    <UserRoundIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">Personal</span>
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
