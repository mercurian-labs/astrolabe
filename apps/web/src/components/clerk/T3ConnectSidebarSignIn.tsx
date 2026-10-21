import { LogInIcon } from "lucide-react";

import { useCloudAccount } from "../../cloud/account";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { Button } from "../ui/button";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { setOpenCloudAccountPage } from "./T3ConnectAccountPages";
import { useT3ConnectAuthPrompt } from "./useT3ConnectAuthPrompt";

export function T3ConnectSidebarSignIn() {
  if (!hasCloudPublicConfig()) return null;

  return <ConfiguredT3ConnectSidebarSignIn />;
}

export function T3ConnectSidebarAvatar() {
  if (!hasCloudPublicConfig()) return null;

  return <ConfiguredT3ConnectSidebarAvatar />;
}

function ConfiguredT3ConnectSidebarAvatar() {
  const { isLoaded, isSignedIn, user } = useCloudAccount();

  if (!isLoaded || !isSignedIn || !user) return null;

  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={`Account: ${user.email}`}
      onClick={() => setOpenCloudAccountPage("account")}
    >
      {user.image ? (
        <img alt="" src={user.image} className="size-7 rounded-full" />
      ) : (
        <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {initial}
        </span>
      )}
    </Button>
  );
}

function ConfiguredT3ConnectSidebarSignIn() {
  const { isLoaded, isSignedIn } = useCloudAccount();
  const { authPrompt, openAuthPrompt } = useT3ConnectAuthPrompt();

  if (!isLoaded || isSignedIn) return null;

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={openAuthPrompt}>
            <LogInIcon />
            <span>Sign in</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {authPrompt}
    </>
  );
}
