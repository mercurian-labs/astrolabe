import type { WikiPlacement } from "@mercurian/wiki/placement";
import { EnvironmentId, type UnifiedSettings } from "@t3tools/contracts";
import {
  type AtomCommand,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { wikiSaveFailure } from "@t3tools/client-runtime/wikiLogic";
import { useAtomValue } from "@effect/atom-react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { usePrimaryEnvironmentId, useEnvironments } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { wikiEnvironment, wikiOverviewsAtom } from "~/state/wiki";
import { toastManager } from "../ui/toast";
import { describeWikiFailure } from "./wiki.logic";

/**
 * The server whose wikis the page shows: the one the URL names while this workspace knows it,
 * else the primary one, else the first.
 */
export function useWikiEnvironment(requested: EnvironmentId | undefined) {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId =
    environments.find((environment) => environment.environmentId === requested)?.environmentId ??
    environments.find((environment) => environment.environmentId === primaryEnvironmentId)
      ?.environmentId ??
    environments[0]?.environmentId ??
    null;
  return { environments, environmentId };
}

/**
 * Every wiki on every connected server, with its index and change requests as they arrive.
 * `loading` holds while any server's list has not arrived yet. With `enabled` false it asks for
 * none, for a caller that needs them only sometimes (the palette's `:e`).
 */
export function useWikiOverviews(enabled = true): {
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly loading: boolean;
} {
  const { environments } = useEnvironments();
  const key = JSON.stringify(
    enabled ? environments.map((environment) => environment.environmentId) : [],
  );
  const lists = useAtomValue(wikiOverviewsAtom(key));
  return {
    overviews: lists.flatMap((list) => list ?? []),
    loading: lists.some((list) => list === null),
  };
}

/** Lands an autosave, reading a failure as the autosave store does. */
export function useWikiAutosaveCommand() {
  const run = useAtomCommand(wikiEnvironment.autosave, { reportFailure: false });
  return async (value: Parameters<typeof run>[0]) => {
    const result = await run(value);
    if (result._tag === "Success") return { ok: true as const, value: result.value };
    return isAtomCommandInterrupted(result)
      ? { ok: false as const, message: "The save was cancelled.", retry: true }
      : wikiSaveFailure(squashAtomCommandFailure(result));
  };
}

const selectLocations = (settings: UnifiedSettings) => settings.wikiLocations;
const NO_ENVIRONMENT = EnvironmentId.make("none");

/** Where `environmentId` puts a wiki's new files; its defaults when there's none to ask. */
export const useWikiPlacement = (environmentId: EnvironmentId | null): WikiPlacement =>
  useEnvironmentSettings(environmentId ?? NO_ENVIRONMENT, selectLocations);

export type WikiCommandOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly message: string | null };

/**
 * Runs a wiki command and reads its failure as words. An interrupted command fails with no
 * message. `failureToast` names the toast a failure raises; omit it to show the message inline.
 */
export function useWikiCommand<W, A, E>(command: AtomCommand<W, A, E>, failureToast?: string) {
  const run = useAtomCommand(command, { reportFailure: false });
  return async (value: W): Promise<WikiCommandOutcome<A>> => {
    const result = await run(value);
    if (result._tag === "Success") return { ok: true, value: result.value };
    if (isAtomCommandInterrupted(result)) return { ok: false, message: null };
    const message = describeWikiFailure(squashAtomCommandFailure(result));
    if (failureToast !== undefined) {
      toastManager.add({ type: "error", title: failureToast, description: message });
    }
    return { ok: false, message };
  };
}
