import { ServerIcon, SmartphoneIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useCloudAccount } from "../../cloud/account";
import { MobileClientsUserProfilePage } from "./MobileClientsUserProfilePage";
import { T3ConnectUserProfilePage } from "./T3ConnectUserProfilePage";

/** Pages in the account dialog after Account, in menu order. */
export const T3_CONNECT_ACCOUNT_PAGES = [
  {
    label: "Mobile clients",
    url: "mobile-clients",
    icon: <SmartphoneIcon className="size-4" />,
    content: <MobileClientsUserProfilePage />,
  },
  {
    label: "Remote access",
    url: "t3-connect",
    icon: <ServerIcon className="size-4" />,
    content: <T3ConnectUserProfilePage />,
  },
] as const;

export type CloudAccountPage = "account" | (typeof T3_CONNECT_ACCOUNT_PAGES)[number]["url"];

let openPage: CloudAccountPage | null = null;
const pageListeners = new Set<() => void>();

/** Opens the account dialog (mounted by `CloudAccountDialogs`) on a page, or closes it. */
export function setOpenCloudAccountPage(page: CloudAccountPage | null): void {
  openPage = page;
  for (const listener of pageListeners) listener();
}

export function useOpenCloudAccountPage(): CloudAccountPage | null {
  return useSyncExternalStore(
    (listener) => {
      pageListeners.add(listener);
      return () => pageListeners.delete(listener);
    },
    () => openPage,
  );
}

/** Opens the account dialog on the T3 Connect page from outside the sidebar avatar. */
export function useT3ConnectAccountPage(): {
  readonly open: (() => void) | null;
  readonly portals: null;
} {
  const { isSignedIn } = useCloudAccount();
  return {
    open: isSignedIn ? () => setOpenCloudAccountPage("t3-connect") : null,
    portals: null,
  };
}
