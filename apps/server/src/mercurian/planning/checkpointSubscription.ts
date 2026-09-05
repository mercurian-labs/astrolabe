import type { PlanId, PlanStreamItem } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { CheckpointRecordStore } from "./CheckpointRecordStore.ts";

/** Page state changes to a fixed high-water. Rows moving past it arrive on the live feed. */
export const checkpointCatchUp = (
  records: CheckpointRecordStore["Service"],
  planId: PlanId,
  after: number,
  through: number,
): Stream.Stream<PlanStreamItem, import("../../persistence/Errors.ts").PersistenceSqlError> =>
  Stream.paginate(after, (cursor) =>
    Effect.gen(function* () {
      const page = yield* records.listSince(planId, cursor, through);
      if (page.length === 0)
        return [
          [
            {
              kind: "checkpoint-synchronized",
              planId,
              checkpointSequence: through,
            } satisfies PlanStreamItem,
          ],
          Option.none<number>(),
        ] as const;
      return [
        page.map((record): PlanStreamItem => ({ kind: "checkpoint-update", record })),
        Option.some(page[page.length - 1]!.updateSequence),
      ] as const;
    }),
  );
