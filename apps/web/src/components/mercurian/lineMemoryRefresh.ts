/** The tuple is produced once per subscription emission by client-runtime's zipWithIndex. */
type Emission = readonly [unknown, number];

export interface LineMemoryRefreshCursor {
  readonly key: string | undefined;
  readonly subscriptionKey: string;
  readonly emission: Emission | undefined;
}

/** Route reads and subscription invalidations are independent, but can share one read. */
export function advanceLineMemoryRefresh(
  previous: LineMemoryRefreshCursor | undefined,
  input: LineMemoryRefreshCursor & { readonly key: string; readonly latest: boolean },
) {
  const sameSubscription = previous?.subscriptionKey === input.subscriptionKey;
  const lastEmission = sameSubscription ? previous.emission : undefined;
  const newEmission = input.emission !== undefined && input.emission !== lastEmission;
  // Index zero is the subscription handshake, covered by the initial route read.
  // A later first-observed index includes a real change and must not be swallowed.
  const invalidate =
    sameSubscription && newEmission && (lastEmission !== undefined || input.emission![1] > 0);
  // Establish the first subscription before reading. Otherwise a capture between
  // the read and the handshake could be missed when the handshake is consumed.
  const ready = input.emission !== undefined || lastEmission !== undefined;
  const read = ready && (previous?.key !== input.key || (invalidate && input.latest));
  return {
    cursor: {
      key: read ? input.key : sameSubscription ? previous.key : undefined,
      subscriptionKey: input.subscriptionKey,
      emission: input.emission ?? lastEmission,
    },
    invalidate,
    read,
  };
}
