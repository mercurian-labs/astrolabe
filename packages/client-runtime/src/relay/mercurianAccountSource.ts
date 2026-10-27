import type { CloudAccountClient } from "@t3tools/shared/mercurianAccount";

import type { CloudAccountSource } from "./cloudAccountService.ts";

export interface MercurianAccountSource extends CloudAccountSource {
  readonly readRelayToken: () => Promise<string | null>;
}

/**
 * Feeds the Mercurian account into `createCloudAccountService`. A session that
 * is still loading reports `user: undefined`, which the service skips, so it
 * never reads as a sign-out.
 */
export function createMercurianAccountSource(
  client: Pick<CloudAccountClient, "getState" | "subscribe" | "readRelayToken">,
): MercurianAccountSource {
  return {
    addListener: (listener) => {
      const emit = () => {
        const state = client.getState();
        listener({
          user:
            state.status === "loading"
              ? undefined
              : state.status === "signedIn"
                ? { id: state.user.id }
                : null,
        });
      };
      const unsubscribe = client.subscribe(emit);
      emit();
      return unsubscribe;
    },
    readRelayToken: () => client.readRelayToken(),
  };
}
