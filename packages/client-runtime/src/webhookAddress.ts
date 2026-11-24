import type { ScheduledTaskWebhookEndpoint } from "@t3tools/contracts";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export interface WebhookAddress {
  readonly address: string;
  readonly copyable: boolean;
  readonly note: string | null;
}

/**
 * Where to send a webhook task's requests. A public URL comes only through remote access, so
 * `remoteAccessAvailable` (the client's cloud config) decides whether the note offers it.
 */
export function webhookAddress(
  endpoint: ScheduledTaskWebhookEndpoint,
  httpBaseUrl: string | null,
  remoteAccessAvailable: boolean,
  resolve: MFunctionType = mFallback,
): WebhookAddress {
  if (endpoint.url !== null) {
    return { address: endpoint.url, copyable: true, note: null };
  }
  if (httpBaseUrl === null) {
    return {
      address: endpoint.path,
      copyable: false,
      note: remoteAccessAvailable
        ? resolve(msg("Turn on remote access for this environment to get a public URL."))
        : resolve(msg("Send requests to this path on this environment's address.")),
    };
  }
  const url = new URL(endpoint.path, httpBaseUrl);
  return {
    address: url.href,
    copyable: true,
    note: isLocalLoopbackHost(url.hostname)
      ? resolve(
          remoteAccessAvailable
            ? msg(
                "Only this computer can call this address. Turn on remote access for a public URL.",
              )
            : msg("Only this computer can call this address."),
        )
      : resolve(
          remoteAccessAvailable
            ? msg(
                "Works wherever this environment's address is reachable, for example over Tailscale or your own proxy. Turn on remote access for a public URL.",
              )
            : msg(
                "Works wherever this environment's address is reachable, for example over Tailscale or your own proxy.",
              ),
        ),
  };
}
