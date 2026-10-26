import type { ScheduledTaskWebhookEndpoint } from "@t3tools/contracts";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";

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
): WebhookAddress {
  if (endpoint.url !== null) {
    return { address: endpoint.url, copyable: true, note: null };
  }
  const publicUrlHint = remoteAccessAvailable ? " Turn on remote access for a public URL." : "";
  if (httpBaseUrl === null) {
    return {
      address: endpoint.path,
      copyable: false,
      note: remoteAccessAvailable
        ? "Turn on remote access for this environment to get a public URL."
        : "Send requests to this path on this environment's address.",
    };
  }
  const url = new URL(endpoint.path, httpBaseUrl);
  return {
    address: url.href,
    copyable: true,
    note: isLocalLoopbackHost(url.hostname)
      ? `Only this computer can call this address.${publicUrlHint}`
      : `Works wherever this environment's address is reachable, for example over Tailscale or your own proxy.${publicUrlHint}`,
  };
}
