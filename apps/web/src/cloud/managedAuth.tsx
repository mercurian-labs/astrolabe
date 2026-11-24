import {
  createCloudAccountService,
  ManagedRelay,
  type MercurianAccountSource,
  setManagedRelaySession,
} from "@t3tools/client-runtime/relay";
import {
  reportAtomCommandResult,
  runAtomCommand,
  settleAsyncResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import { useEffect, type ReactNode } from "react";

import { environmentCatalog } from "../connection/catalog";
import { runtime } from "../lib/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { cloudAccountSource, refreshCloudAccount } from "./account";

export function deactivateManagedRelayAuthentication(): void {
  setManagedRelaySession(appAtomRegistry, null);
}

export function activateManagedRelayAuthentication(
  accountId: string,
  readClerkToken: () => Promise<string | null>,
): void {
  setManagedRelaySession(appAtomRegistry, {
    accountId,
    readClerkToken,
  });
}

// A failed route removal fails the switch, so the next account never activates over the old routes.
async function cleanUpManagedRelayAccount(): Promise<void> {
  const [removal, tokenReset] = await Promise.all([
    runAtomCommand(appAtomRegistry, environmentCatalog.removeRelayEnvironments, undefined, {
      reportFailure: false,
      reportDefect: false,
    }),
    settleAsyncResult(() =>
      runtime.runPromiseExit(
        ManagedRelay.ManagedRelayClient.pipe(Effect.flatMap((client) => client.resetTokenCache)),
      ),
    ),
  ]);
  reportAtomCommandResult(tokenReset, { label: "cloud account cleanup" });
  if (removal._tag !== "Success") throw squashAtomCommandFailure(removal);
}

const managedRelayAccountService = createCloudAccountService<MercurianAccountSource>({
  deactivate: deactivateManagedRelayAuthentication,
  detach: deactivateManagedRelayAuthentication,
  cleanUp: cleanUpManagedRelayAccount,
  activate: ({ source, accountId }) =>
    activateManagedRelayAuthentication(accountId, source.readRelayToken),
});

export function ManagedRelayAuthProvider({ children }: { readonly children: ReactNode }) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- attaches the Mercurian account source to the managed relay account service for the provider's lifetime
  useEffect(() => {
    const source = cloudAccountSource();
    return source ? managedRelayAccountService.attach(source) : undefined;
  }, []);

  // Picks up sign-ins and sign-outs from other tabs and devices. A failed
  // read (offline at launch) leaves the account loading, so retry it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to window focus to re-read the session cookie
  useEffect(() => {
    let retry: number | undefined;
    const refresh = () => {
      window.clearTimeout(retry);
      void refreshCloudAccount().catch((error: unknown) => {
        console.warn("Could not read the Astrolabe session", error);
        retry = window.setTimeout(refresh, 15_000);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return children;
}
