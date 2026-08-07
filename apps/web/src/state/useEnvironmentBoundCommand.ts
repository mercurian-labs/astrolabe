import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback } from "react";

import { usePrimaryEnvironmentId } from "./environments";
import { useAtomCommand } from "./use-atom-command";

type BoundCommand<Input, Output> = Parameters<
  typeof useAtomCommand<Output, unknown, { environmentId: EnvironmentId; input: Input }>
>[0];

/**
 * A Mercurian write, bound to the primary environment.
 *
 * Mercurian's store lives on one environment, so nothing that calls it carries
 * an environment id — cross-environment planning is a later question, and
 * environments-as-navigation is exactly what this reshaping removed.
 *
 * The result is the value or `null`: the caller only needs to know whether the
 * act landed. Use {@link useEnvironmentBoundCommandResult} where a refusal is
 * something the surface has to render rather than merely survive.
 */
export function useEnvironmentBoundCommand<Input, Output>(command: BoundCommand<Input, Output>) {
  const environmentId = usePrimaryEnvironmentId();
  const run = useAtomCommand(command);
  return useCallback(
    (input: Input) => {
      if (environmentId === null) {
        return Promise.resolve(null);
      }
      return run({ environmentId, input }).then((result) =>
        result._tag === "Success" ? result.value : null,
      );
    },
    [environmentId, run],
  );
}

/**
 * What a bound command answered: the value, or the refusal that came back.
 *
 * `error` is the squashed failure, which is what a dialog showing a refusal in
 * place needs — the tagged error itself, not a message someone re-derived.
 */
export type EnvironmentBoundCommandResult<Output> =
  | { readonly ok: true; readonly value: Output }
  | { readonly ok: false; readonly error: unknown };

/**
 * The same bind, for acts whose refusals are part of the surface: registering
 * a path that is already registered, removing a repository the app still holds
 * worktrees on. Failures are reported here rather than by a toast, so the
 * dialog that asked can answer in place.
 */
export function useEnvironmentBoundCommandResult<Input, Output>(
  command: BoundCommand<Input, Output>,
) {
  const environmentId = usePrimaryEnvironmentId();
  const run = useAtomCommand(command, { reportFailure: false });
  return useCallback(
    async (input: Input): Promise<EnvironmentBoundCommandResult<Output>> => {
      if (environmentId === null) {
        return { ok: false, error: new Error("No environment is connected.") };
      }
      const result = await run({ environmentId, input });
      return result._tag === "Success"
        ? { ok: true, value: result.value }
        : { ok: false, error: squashAtomCommandFailure(result) };
    },
    [environmentId, run],
  );
}
