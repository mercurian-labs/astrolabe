import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { RelayT3ChatLink } from "@t3tools/contracts/relay";

export class T3ChatNotConfigured extends Schema.TaggedError<T3ChatNotConfigured>()(
  "T3ChatNotConfigured",
  {},
) {
  override get message(): string {
    return "T3 Chat linking is not configured on this relay";
  }
}

export class ClerkUserLookupFailed extends Schema.TaggedError<ClerkUserLookupFailed>()(
  "ClerkUserLookupFailed",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the Clerk user's primary email";
  }
}

export class T3ChatRequestFailed extends Schema.TaggedError<T3ChatRequestFailed>()(
  "T3ChatRequestFailed",
  {
    operation: Schema.Literals(["get-link", "unlink"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `T3 Chat '${this.operation}' request failed`;
  }
}

/**
 * Upstream's bridge to T3 Chat accounts and plan-based tunnel caps. Astrolabe's relay has no
 * T3 Chat link (it would send the account's email to t3.chat), so the service is never available.
 */
export class T3ChatAccounts extends Context.Service<
  T3ChatAccounts,
  {
    readonly available: boolean;
    readonly createLinkUrl: (input: {
      readonly userId: string;
    }) => Effect.Effect<string, T3ChatNotConfigured | ClerkUserLookupFailed>;
    readonly getLink: (input: {
      readonly userId: string;
    }) => Effect.Effect<RelayT3ChatLink | null, T3ChatNotConfigured | T3ChatRequestFailed>;
    readonly unlink: (input: {
      readonly userId: string;
    }) => Effect.Effect<void, T3ChatNotConfigured | T3ChatRequestFailed>;
  }
>()("t3code-relay/t3chat/T3ChatAccounts") {}

export const layer = Layer.succeed(
  T3ChatAccounts,
  T3ChatAccounts.of({
    available: false,
    createLinkUrl: Effect.fn("relay.t3chat.create_link_url")(function* () {
      return yield* new T3ChatNotConfigured();
    }),
    getLink: Effect.fn("relay.t3chat.get_link")(function* () {
      return null;
    }),
    unlink: Effect.fn("relay.t3chat.unlink")(function* () {
      return yield* new T3ChatNotConfigured();
    }),
  }),
);
