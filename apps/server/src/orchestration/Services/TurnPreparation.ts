import type { OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface TurnPreparationInput {
  readonly thread: OrchestrationThread;
  readonly message: OrchestrationMessage;
  readonly sessionIsFresh: boolean;
}

export interface PreparedTurn {
  readonly text: string;
  readonly session: {
    readonly isolateProviderSettings?: boolean;
    readonly skipResume?: boolean;
  };
}

export class TurnPreparation extends Context.Service<
  TurnPreparation,
  {
    readonly prepare: (input: TurnPreparationInput) => Effect.Effect<PreparedTurn, object>;
  }
>()("t3/orchestration/Services/TurnPreparation") {}

export const TurnPreparationDefault = Layer.succeed(
  TurnPreparation,
  TurnPreparation.of({
    prepare: ({ message }) => Effect.succeed({ text: message.text, session: {} }),
  }),
);
