import type {
  EnvironmentId,
  PullRequestRef,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import {
  type AtomCommand,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { useAtomValue } from "@effect/atom-react";

import { usePrimaryEnvironmentId, useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { wikiEnvironment, wikiOverviewsAtom } from "~/state/wiki";
import { toastManager } from "../ui/toast";
import type { FullPullRequestTarget } from "../pullRequest/pullRequestTabs";
import {
  describeWikiFailure,
  hostedPullRequestKeys,
  hostedWikis,
  wikiPullRequestHost,
  wikiTerms,
} from "./wiki.logic";

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

/** The pull requests that are host wikis' own change requests. */
export function useHostedPullRequestKeys(enabled: boolean): ReadonlySet<string> {
  const { overviews } = useWikiOverviews(enabled);
  return hostedPullRequestKeys(hostedWikis(overviews));
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

/**
 * The pull request a host wiki's change request is, once the host has it: a host wiki is
 * reviewed and merged on the same screen as a repository's pull requests.
 */
export function useWikiChangeRequestPullRequest(
  environmentId: EnvironmentId,
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId | null,
): FullPullRequestTarget | null {
  const list = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const host = list.data?.wikis.find((entry) => entry.wikiId === wikiId)?.host ?? null;
  const changeRequests = useEnvironmentQuery(
    host === null || changeRequestId === null
      ? null
      : wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }),
  );
  const pullRequest =
    changeRequests.data?.changeRequests.find((entry) => entry.changeRequestId === changeRequestId)
      ?.pullRequest ?? null;
  const pullRequestHost = pullRequest === null ? null : wikiPullRequestHost(pullRequest.url);
  if (host === null || pullRequest === null || pullRequestHost === null) return null;
  return {
    environmentId,
    projectId: host.projectId,
    host: pullRequestHost,
    repository: pullRequest.repository,
    number: pullRequest.number,
  };
}

/** What a wiki calls its reviews, by its host. */
export function useWikiTerms(environmentId: EnvironmentId | undefined, wikiId: WikiId | undefined) {
  const { data } = useEnvironmentQuery(
    environmentId === undefined ? null : wikiEnvironment.list({ environmentId, input: {} }),
  );
  return wikiTerms(data?.wikis.find((entry) => entry.wikiId === wikiId));
}

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
