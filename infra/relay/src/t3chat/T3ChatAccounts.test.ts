import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as T3ChatAccounts from "./T3ChatAccounts.ts";

describe("T3ChatAccounts", () => {
  it.effect("never links a T3 Chat account", () =>
    Effect.gen(function* () {
      const accounts = yield* T3ChatAccounts.T3ChatAccounts;
      expect(accounts.available).toBe(false);
      expect(yield* accounts.getLink({ userId: "user_1" })).toBeNull();
      const error = yield* Effect.flip(accounts.createLinkUrl({ userId: "user_1" }));
      expect(error._tag).toBe("T3ChatNotConfigured");
    }).pipe(Effect.provide(T3ChatAccounts.layer)),
  );
});
