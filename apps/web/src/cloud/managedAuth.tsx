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

const managedRelayAccountService = createCloudAccountService<MercurianAccountSource>({
  deactivate: deactivateManagedRelayAuthentication,
  detach: deactivateManagedRelayAuthentication,
  cleanUp: async () => {
    const results = await Promise.all([
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
    for (const result of results) {
      reportAtomCommandResult(result, { label: "cloud account cleanup" });
    }
  },
  activate: ({ source, accountId }) =>
    activateManagedRelayAuthentication(accountId, source.readRelayToken),
});

export function ManagedRelayAuthProvider({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    const source = cloudAccountSource();
    return source ? managedRelayAccountService.attach(source) : undefined;
  }, []);

  // Picks up sign-ins and sign-outs from other tabs and devices. A failed
  // read (offline at launch) leaves the account loading, so retry it.
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
