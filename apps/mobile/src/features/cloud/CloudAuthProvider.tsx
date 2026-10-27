import type { ReactNode } from "react";

import { useWorkspaceDataCleanup } from "../workspaces/workspaceSync";
import { cloudAccountSource, useCloudAccountRefresh } from "./account";
import { cloudAccountService, deactivateCloudRelayAccount } from "./cloudAccountService";
import { hasCloudPublicConfig } from "./publicConfig";

// Build-time constant: null when this build has no cloud config.
const accountSource = hasCloudPublicConfig() ? cloudAccountSource() : null;

if (accountSource) {
  // The account client lives for the app's lifetime, so the service observes
  // it without a React subscription.
  cloudAccountService.attach(accountSource);
} else {
  // Without cloud config no account can ever activate, so drop anything a
  // previous build with cloud enabled left registered.
  deactivateCloudRelayAccount();
}

function CloudAccountSync(props: { readonly children: ReactNode }) {
  useCloudAccountRefresh();
  useWorkspaceDataCleanup();
  return props.children;
}

export function CloudAuthProvider(props: { readonly children: ReactNode }) {
  if (!accountSource) {
    return props.children;
  }

  return <CloudAccountSync>{props.children}</CloudAccountSync>;
}
