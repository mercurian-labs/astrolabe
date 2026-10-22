import {
  type CloudAccountClient,
  type CloudAccountState,
  type CloudConnection,
  createCloudAccountClient,
} from "@t3tools/shared/mercurianAccount";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

import { resolveCloudPublicConfig } from "./publicConfig";

export type { CloudAccountUser } from "@t3tools/shared/mercurianAccount";

const SESSION_TOKEN_KEY = "astrolabe.cloud-session-token";
const LOADING: CloudAccountState = { status: "loading" };

let client: CloudAccountClient | null = null;

/**
 * Signing in on mobile: a device code approved in the in-app
 * browser sheet, with the session token in the keychain. No native sign-in
 * forms, so passkeys and every provider work exactly as on the web.
 */
function accountClient(): CloudAccountClient | null {
  const authUrl = resolveCloudPublicConfig().auth.url;
  if (!authUrl) return null;
  client ??= createCloudAccountClient({
    authUrl,
    sessionCookie: false,
    deviceClientId: "astrolabe-mobile",
    storage: {
      read: () => SecureStore.getItemAsync(SESSION_TOKEN_KEY),
      write: (token) =>
        token === null
          ? SecureStore.deleteItemAsync(SESSION_TOKEN_KEY)
          : SecureStore.setItemAsync(SESSION_TOKEN_KEY, token),
    },
  });
  return client;
}

/** How the workspace client reaches the cloud as the signed-in account. */
export function cloudConnection(): CloudConnection | null {
  return accountClient()?.connection ?? null;
}

export function refreshCloudAccount(): Promise<void> {
  return accountClient()?.refresh() ?? Promise.resolve();
}

/**
 * Reads the session now and whenever the app returns, to pick up sign-outs
 * elsewhere. A failed read (offline at launch) leaves the account loading, so
 * retry it.
 */
export function useCloudAccountRefresh(): void {
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(retry);
      void refreshCloudAccount().catch((error: unknown) => {
        console.warn("Could not read the Astrolabe session", error);
        retry = setTimeout(refresh, 15_000);
      });
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearTimeout(retry);
      subscription.remove();
    };
  }, []);
}

export function readCloudRelayToken(): Promise<string | null> {
  return accountClient()?.readRelayToken() ?? Promise.resolve(null);
}

/** Opens the approval page in the browser sheet and closes it once signed in. */
export function startCloudSignIn(): void {
  const account = accountClient();
  if (!account) return;
  void account
    .startDeviceSignIn((signIn) => {
      void WebBrowser.openBrowserAsync(signIn.verificationUrl);
    })
    .then(() => {
      // Only iOS can close the sheet; on Android the person returns with Back.
      if (account.getState().status === "signedIn" && Platform.OS === "ios") {
        void WebBrowser.dismissBrowser().catch(() => undefined);
      }
    })
    .catch((error: unknown) => console.error("Sign-in failed", error));
}

export function cancelCloudSignIn(): void {
  accountClient()?.cancelDeviceSignIn();
}

export function openCloudSignInPage(url: string): void {
  void WebBrowser.openBrowserAsync(url);
}

/** Opens account settings (password, passkeys, linked sign-ins) on app.astrolabe.sh. */
export function openCloudAccountSettings(): void {
  const authUrl = resolveCloudPublicConfig().auth.url;
  if (authUrl) openCloudSignInPage(new URL("/account", authUrl).toString());
}

export function signOutCloudAccount(): Promise<void> {
  return accountClient()?.signOut() ?? Promise.resolve();
}

export function deleteCloudAccount() {
  const account = accountClient();
  return account
    ? account.deleteAccount()
    : Promise.resolve({
        _tag: "Failed",
        message: "Sign-in is not configured.",
      } as const);
}

const subscribe = (listener: () => void) => accountClient()?.subscribe(listener) ?? (() => {});

export function useCloudAccountState(): CloudAccountState {
  return useSyncExternalStore(subscribe, () => accountClient()?.getState() ?? LOADING);
}

/** The account in the shape the app's Clerk-era callers expect; `getToken` returns a relay token. */
export function useCloudAccount() {
  const account = useCloudAccountState();
  const user = account.status === "signedIn" ? account.user : null;
  return {
    isLoaded: account.status !== "loading",
    isSignedIn: user !== null,
    userId: user?.id ?? null,
    user,
    getToken: readCloudRelayToken,
  };
}
