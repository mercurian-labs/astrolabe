import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { usePrimaryEnvironmentId } from "./environments";
import { useAtomCommand } from "./use-atom-command";

/**
 * Bind a command atom to the primary environment.
 *
 * Mercurian's stores live on the primary environment, so its routes carry no
 * environment id — cross-environment planning is a later question. This turns
 * an environment-keyed command into a plain `(input) => Promise<Output | null>`,
 * answering `null` both when there is no environment to send to and when the
 * command failed: callers render the refusal from the surface's own state, not
 * from a rejected promise.
 */
export function useEnvironmentBoundCommand<Input, Output>(
  command: Parameters<
    typeof useAtomCommand<Output, unknown, { environmentId: EnvironmentId; input: Input }>
  >[0],
) {
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
