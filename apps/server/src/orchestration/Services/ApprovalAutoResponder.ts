import type { ProviderApprovalDecision, ProviderRuntimeEvent, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export type ApprovalOpenedEvent = Extract<
  ProviderRuntimeEvent,
  { readonly type: "request.opened" }
>;

export class ApprovalAutoResponder extends Context.Service<
  ApprovalAutoResponder,
  {
    readonly decide: (input: {
      readonly threadId: ThreadId;
      readonly request: ApprovalOpenedEvent;
    }) => Effect.Effect<Option.Option<ProviderApprovalDecision>, object>;
  }
>()("t3/orchestration/Services/ApprovalAutoResponder") {}

export const ApprovalAutoResponderDefault = Layer.succeed(
  ApprovalAutoResponder,
  ApprovalAutoResponder.of({ decide: () => Effect.succeed(Option.none()) }),
);
