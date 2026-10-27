import { useNavigate } from "@tanstack/react-router";
import { LogInIcon, LogOutIcon, SettingsIcon, UserRoundIcon, UsersIcon } from "lucide-react";

import {
  type CloudAccountUser,
  signOutCloudAccount,
  startCloudSignIn,
  useCloudAccountState,
} from "../../cloud/account";
import { isElectron } from "../../env";
import { cn, isMacPlatform } from "../../lib/utils";
import { setOpenCloudAccountPage } from "../clerk/T3ConnectAccountPages";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Only the desktop app's menu binds this; a browser keeps the key for itself.
const SETTINGS_SHORTCUT = isElectron ? (isMacPlatform(navigator.platform) ? "⌘," : "Ctrl+,") : null;

/**
 * Settings and the cloud account behind one button: a gear until sign-in, then the avatar. Builds
 * without sign-in keep a plain Settings button, so render this only when `hasCloudPublicConfig()`.
 * `side` is where the menu opens (right of the rail, or above the narrow sidebar's footer);
 * `onNavigate` runs before any row leaves the page.
 */
export function AccountMenu({
  side,
  active = false,
  onNavigate,
}: {
  side: "right" | "top";
  active?: boolean;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const account = useCloudAccountState();
  const user = account.status === "signedIn" ? account.user : null;
  const label = user ? user.name || user.email : "Settings";
  const go = (to: "/settings" | "/settings/workspaces") => {
    onNavigate?.();
    void navigate({ to });
  };

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <SidebarMenuButton
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  isActive={active}
                  size="icon"
                >
                  {user ? <Avatar user={user} className="size-6 text-3xs" /> : <SettingsIcon />}
                </SidebarMenuButton>
              }
            />
          }
        />
        <TooltipPopup side={side}>{label}</TooltipPopup>
      </Tooltip>
      <MenuPopup side={side} align={side === "right" ? "end" : "start"} className="min-w-56">
        {user ? (
          <>
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <Avatar user={user} className="size-8 text-xs" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {user.name || user.email}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.access === "waitlisted" || user.access === "declined"
                    ? "On the waitlist"
                    : user.email}
                </p>
              </div>
            </div>
            <MenuSeparator />
            <MenuItem onClick={() => setOpenCloudAccountPage("account")}>
              <UserRoundIcon />
              Account
            </MenuItem>
            <MenuItem onClick={() => go("/settings/workspaces")}>
              <UsersIcon />
              Workspaces
            </MenuItem>
          </>
        ) : account.status === "signedOut" ? (
          <MenuItem onClick={startCloudSignIn}>
            <LogInIcon />
            Sign in
          </MenuItem>
        ) : null}
        <MenuItem onClick={() => go("/settings")}>
          <SettingsIcon />
          Settings
          {SETTINGS_SHORTCUT ? <MenuShortcut>{SETTINGS_SHORTCUT}</MenuShortcut> : null}
        </MenuItem>
        {user ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => void signOutCloudAccount()}>
              <LogOutIcon />
              Sign out
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function Avatar({ user, className }: { user: CloudAccountUser; className: string }) {
  if (user.image) {
    return <img alt="" src={user.image} className={cn(className, "shrink-0 rounded-full")} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        className,
        "flex shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground",
      )}
    >
      {initials(user)}
    </span>
  );
}

/** Up to two letters: first and last word of the name, else the email's first letter. */
function initials(user: CloudAccountUser): string {
  const words = user.name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? user.email.charAt(0);
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}
