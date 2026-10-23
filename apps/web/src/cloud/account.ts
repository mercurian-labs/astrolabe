import {
  type CloudAccountClient,
  type CloudAccountState,
  type CloudConnection,
  createCloudAccountClient,
} from "@t3tools/shared/mercurianAccount";
import { useSyncExternalStore } from "react";

import { isElectron } from "../env";
import { isHostedStaticApp } from "../hostedPairing";
import { readLocalApi } from "../localApi";
import { resolveCloudPublicConfig } from "./publicConfig";

export type { CloudAccountUser } from "@t3tools/shared/mercurianAccount";

const SESSION_TOKEN_STORAGE_KEY = "astrolabe:cloud-session-token";
const LOADING: CloudAccountState = { status: "loading" };

// Only the hosted app shares the sign-in pages' origin and cookie; the desktop
// shell and self-hosted origins sign in with a device code instead.
const usesSessionCookie = () => !isElectron && isHostedStaticApp();

let client: CloudAccountClient | null = null;

function accountClient(): CloudAccountClient | null {
  const { authUrl } = resolveCloudPublicConfig();
  if (!authUrl) return null;
  client ??= createCloudAccountClient({
    authUrl,
    sessionCookie: usesSessionCookie(),
    deviceClientId: isElectron ? "astrolabe-desktop" : `astrolabe-web:${window.location.host}`,
    storage: {
      read: async () => window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY),
      write: async (token) => {
        if (token === null) window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
        else window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
      },
    },
  });
  return client;
}

/** How the workspace client reaches the cloud as the signed-in account; null when sign-in isn't configured. */
export function cloudConnection(): CloudConnection | null {
  return accountClient()?.connection ?? null;
}

export function refreshCloudAccount(): Promise<void> {
  return accountClient()?.refresh() ?? Promise.resolve();
}

export function readCloudRelayToken(): Promise<string | null> {
  return accountClient()?.readRelayToken() ?? Promise.resolve(null);
}

export function openCloudSignInPage(url: string): void {
  const api = readLocalApi();
  if (api) void api.shell.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

/**
 * Starts signing in. The hosted app goes to the app.astrolabe.sh sign-in
 * page and comes back with the shared cookie. Everywhere else shows a code to
 * approve there (see `CloudSignInDialog`); the desktop opens the page itself,
 * while a browser waits for a click so the new tab isn't blocked.
 */
export function startCloudSignIn(): void {
  const { authUrl } = resolveCloudPublicConfig();
  const account = accountClient();
  if (!authUrl || !account) return;
  if (usesSessionCookie()) {
    const signIn = new URL("/sign-in", authUrl);
    signIn.searchParams.set("callbackURL", window.location.href);
    window.location.assign(signIn.toString());
    return;
  }
  void account
    .startDeviceSignIn((signIn) => {
      if (isElectron) openCloudSignInPage(signIn.verificationUrl);
    })
    .catch((error: unknown) => console.error("Sign-in failed", error));
}

export function cancelCloudSignIn(): void {
  accountClient()?.cancelDeviceSignIn();
}

/** Opens account settings (password, passkeys, linked sign-ins) on app.astrolabe.sh. */
export function openCloudAccountSettings(): void {
  const { authUrl } = resolveCloudPublicConfig();
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

/**
 * The account in the shape the app's Clerk-era callers expect. `getToken`
 * is stable and returns a relay token.
 */
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
