import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import type { MercurianProjectId } from "@t3tools/contracts";

import type { SlotLease, SlotLeaseHolder, WorktreeSlotId } from "./schema.ts";

export class SlotRegistry extends Context.Service<
  SlotRegistry,
  {
    readonly withProjectLock: <A, E, R>(
      projectId: MercurianProjectId,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly acquire: (
      slotId: WorktreeSlotId,
      holder: SlotLeaseHolder,
      acquiredAt: string,
    ) => Effect.Effect<void>;
    /** True when this release removed the slot's final holder. */
    readonly release: (slotId: WorktreeSlotId, holder: SlotLeaseHolder) => Effect.Effect<boolean>;
    readonly lease: (slotId: WorktreeSlotId) => Effect.Effect<Option.Option<SlotLease>>;
    readonly changes: Stream.Stream<void>;
  }
>()("t3/mercurian/worktreeSlots/SlotRegistry") {}

export const make = Effect.gen(function* () {
  type ReleaseResult = { readonly changed: boolean; readonly free: boolean };
  const leases = yield* Ref.make<ReadonlyMap<WorktreeSlotId, SlotLease>>(new Map());
  const locks = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map());
  const changes = yield* PubSub.unbounded<void>();
  const holderKey = (holder: SlotLeaseHolder) =>
    holder.kind === "turn"
      ? `turn:${holder.threadId}`
      : holder.kind === "terminal"
        ? `terminal:${holder.threadId}:${holder.terminalId}`
        : `preview:${holder.threadId}:${holder.previewId}`;
  const getLock = Effect.fn("SlotRegistry.getLock")(function* (projectId: MercurianProjectId) {
    const existing = (yield* Ref.get(locks)).get(projectId);
    if (existing) return existing;
    const created = yield* Semaphore.make(1);
    return yield* Ref.modify(locks, (current) => {
      const raced = current.get(projectId);
      if (raced) return [raced, current] as const;
      const next = new Map(current);
      next.set(projectId, created);
      return [created, next] as const;
    });
  });

  return SlotRegistry.of({
    withProjectLock: (projectId, effect) =>
      getLock(projectId).pipe(Effect.flatMap((lock) => lock.withPermits(1)(effect))),
    acquire: (slotId, holder, acquiredAt) =>
      Ref.modify(leases, (current) => {
        const existing = current.get(slotId);
        if (existing?.holders.some((candidate) => holderKey(candidate) === holderKey(holder))) {
          return [false, current] as const;
        }
        const next = new Map(current);
        next.set(slotId, {
          holders: [...(existing?.holders ?? []), holder],
          acquiredAt: existing?.acquiredAt ?? acquiredAt,
        });
        return [true, next] as const;
      }).pipe(
        Effect.tap((acquired) => (acquired ? PubSub.publish(changes, undefined) : Effect.void)),
        Effect.asVoid,
      ),
    release: (slotId, holder) =>
      Ref.modify(
        leases,
        (current): readonly [ReleaseResult, ReadonlyMap<WorktreeSlotId, SlotLease>] => {
          const lease = current.get(slotId);
          if (lease === undefined) {
            return [{ changed: false, free: false } satisfies ReleaseResult, current] as const;
          }
          const holders = lease.holders.filter(
            (candidate) => holderKey(candidate) !== holderKey(holder),
          );
          if (holders.length === lease.holders.length) {
            return [{ changed: false, free: false } satisfies ReleaseResult, current] as const;
          }
          const next = new Map(current);
          if (holders.length === 0) next.delete(slotId);
          else next.set(slotId, { ...lease, holders });
          return [
            { changed: true, free: holders.length === 0 } satisfies ReleaseResult,
            next,
          ] as const;
        },
      ).pipe(
        Effect.tap(({ changed }) => (changed ? PubSub.publish(changes, undefined) : Effect.void)),
        Effect.map(({ free }) => free),
      ),
    lease: (slotId) =>
      Ref.get(leases).pipe(Effect.map((current) => Option.fromNullishOr(current.get(slotId)))),
    get changes() {
      return Stream.fromPubSub(changes);
    },
  });
});

export const layer = Layer.effect(SlotRegistry, make);
