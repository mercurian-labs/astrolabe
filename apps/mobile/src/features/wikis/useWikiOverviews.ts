import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { describeWikiFailure } from "@t3tools/client-runtime/wikiLogic";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { use, useCallback, useMemo } from "react";

import { wikiEnvironment, wikiOverviewsAtom } from "../../state/wiki";

/**
 * Per server in `key` (a JSON array of environment ids), why its wiki list could not be read,
 * or null. A server that cannot list wikis would otherwise read as loading for good.
 */
const wikiListFailuresAtom = Atom.family((key: string) =>
  Atom.make((get) =>
    (JSON.parse(key) as EnvironmentId[]).map((environmentId) => {
      const result = get(wikiEnvironment.list({ environmentId, input: {} }));
      return AsyncResult.isFailure(result) && Option.isNone(AsyncResult.value(result))
        ? describeWikiFailure(Cause.squash(result.cause))
        : null;
    }),
  ).pipe(Atom.withLabel(`wiki-list-failures:${key}`)),
);

/**
 * Every wiki on the given servers, as web's `useWikiOverviews` reads them, and a refresh.
 * Pass a memoized `environmentIds`.
 */
export function useWikiOverviews(environmentIds: ReadonlyArray<EnvironmentId>) {
  const registry = use(RegistryContext);
  const key = JSON.stringify(environmentIds);
  const lists = useAtomValue(wikiOverviewsAtom(key));
  const failed = useAtomValue(wikiListFailuresAtom(key));
  const result = useMemo(() => {
    const failures = environmentIds.flatMap((environmentId, index) => {
      const message = failed[index];
      return message ? [{ environmentId, message }] : [];
    });
    return {
      overviews: lists.flatMap((list) => list ?? []),
      loading: lists.some((list, index) => list === null && !failed[index]),
      failures,
    };
  }, [environmentIds, lists, failed]);
  const { overviews } = result;

  /** Reads every list, index, and change request list again; settles when all have. */
  const refresh = useCallback(async () => {
    const options = { refresh: true, reportFailure: false } as const;
    await Promise.allSettled([
      ...environmentIds.map((environmentId) =>
        executeAtomQuery(registry, wikiEnvironment.list({ environmentId, input: {} }), options),
      ),
      ...overviews.flatMap(({ environmentId, wiki }) => [
        executeAtomQuery(
          registry,
          wikiEnvironment.index({ environmentId, input: { wikiId: wiki.wikiId } }),
          options,
        ),
        executeAtomQuery(
          registry,
          wikiEnvironment.changeRequests({ environmentId, input: { wikiId: wiki.wikiId } }),
          options,
        ),
      ]),
    ]);
  }, [registry, environmentIds, overviews]);

  return { ...result, refresh };
}
