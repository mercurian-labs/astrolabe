import type { DiscoveredLocalServer } from "@t3tools/contracts";

export interface SessionPreviewOfferItem {
  readonly label: string;
  readonly port: DiscoveredLocalServer;
}

export function sessionPreviewOffers(
  ports: ReadonlyArray<DiscoveredLocalServer>,
): ReadonlyArray<SessionPreviewOfferItem> {
  return ports.map((port) => ({ port, label: `${port.host}:${port.port}` }));
}
