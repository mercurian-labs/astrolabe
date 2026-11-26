/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type { WikiPlacement } from "@mercurian/wiki/placement";
import {
  EnvironmentId,
  type PullRequestRef,
  type UnifiedSettings,
  type WikiId,
} from "@t3tools/contracts";
import {
  type AtomCommand,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { wikiSaveFailure } from "@t3tools/client-runtime/wikiLogic";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { usePrimaryEnvironmentId, useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { wikiEnvironment } from "~/state/wiki";
import { toastManager } from "../ui/toast";
import { describeWikiFailure, wikiTerms } from "./wiki.logic";

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
 * The host wiki change request a pull request is, read by the project the wiki was given when
 * it connected; null for every other pull request.
 */
export function useWikiOfPullRequest(
  environmentId: EnvironmentId,
  reference: Pick<PullRequestRef, "projectId" | "repository" | "number">,
) {
  const list = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const wiki =
    list.data?.wikis.find((entry) => entry.host?.projectId === reference.projectId) ?? null;
  const changeRequests = useEnvironmentQuery(
    wiki === null
      ? null
      : wikiEnvironment.changeRequests({ environmentId, input: { wikiId: wiki.wikiId } }),
  );
  const changeRequest =
    changeRequests.data?.changeRequests.find(
      (entry) =>
        entry.pullRequest?.number === reference.number &&
        entry.pullRequest.repository.toLowerCase() === reference.repository.toLowerCase(),
    ) ?? null;
  return wiki === null || changeRequest === null ? null : { wiki, changeRequest };
}

/** What a wiki calls its reviews, by its host. */
export function useWikiTerms(environmentId: EnvironmentId | undefined, wikiId: WikiId | undefined) {
  const { data } = useEnvironmentQuery(
    environmentId === undefined ? null : wikiEnvironment.list({ environmentId, input: {} }),
  );
  return wikiTerms(data?.wikis.find((entry) => entry.wikiId === wikiId));
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
