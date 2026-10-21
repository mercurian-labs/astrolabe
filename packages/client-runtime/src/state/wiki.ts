import {
  WS_METHODS,
  type EnvironmentId,
  type WikiChangeRequest,
  type WikiEvent,
  type WikiId,
  type WikiIndexResult,
  type WikiSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** One wiki as the Wikis sidebar lists it. */
export interface WikiOverview {
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  readonly index: WikiIndexResult | null;
  readonly changeRequests: ReadonlyArray<WikiChangeRequest> | null;
}

/**
 * Astrolabe: local wikis. Reads are queries that read again when `wiki.subscribe` reports a
 * change: the wiki list on any change, everything else only on changes to its own wiki, and
 * only while a view reads it. Writes are permission-guarded commands; the server pushes the
 * change that refreshes the views, so commands patch no caches.
 */
export function createWikiEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const events = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:wiki:events",
    tag: WS_METHODS.wikiSubscribe,
  });

  /** The latest change on an environment; a new value per change. */
  const latestChange = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): WikiEvent | null =>
      Option.getOrNull(AsyncResult.value(get(events({ environmentId, input: {} })))),
    ).pipe(Atom.withLabel(`environment-data:wiki:latest-change:${environmentId}`)),
  );

  /** The latest change to one wiki. Changes to other wikis leave it, and its readers, alone. */
  const wikiChangeByKey = Atom.family((key: string) => {
    const [environmentId, wikiId] = JSON.parse(key) as [EnvironmentId, WikiId];
    return Atom.make((get): WikiEvent | null => {
      const event = get(latestChange(environmentId));
      if (event !== null && event.wikiId === wikiId) return event;
      return Option.getOrNull(get.self<WikiEvent | null>()) ?? null;
    }).pipe(Atom.withLabel(`environment-data:wiki:change:${key}`));
  });
  const wikiChange = (environmentId: EnvironmentId, wikiId: WikiId) =>
    wikiChangeByKey(JSON.stringify([environmentId, wikiId]));

  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:wiki:list",
    tag: WS_METHODS.wikiList,
    refreshTrigger: ({ environmentId }) => latestChange(environmentId),
  });
  const index = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:wiki:index",
    tag: WS_METHODS.wikiIndex,
    refreshTrigger: ({ environmentId, input }) => wikiChange(environmentId, input.wikiId),
  });
  const changeRequests = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:wiki:change-requests",
    tag: WS_METHODS.wikiChangeRequestsList,
    refreshTrigger: ({ environmentId, input }) =>
      input.wikiId === undefined
        ? latestChange(environmentId)
        : wikiChange(environmentId, input.wikiId),
  });

  /**
   * Every wiki on an environment with its main line's index and its change requests, each
   * null until it arrives; null while the list itself loads. Reads the same queries the views
   * read, so it shares their caches and refreshes.
   */
  const overview = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyArray<WikiOverview> | null => {
      const value = <A>(result: AsyncResult.AsyncResult<A, unknown>) =>
        Option.getOrNull(AsyncResult.value(result));
      const listed = value(get(list({ environmentId, input: {} })));
      if (listed === null) return null;
      return listed.wikis.map((wiki) => ({
        environmentId,
        wiki,
        index: value(get(index({ environmentId, input: { wikiId: wiki.wikiId } }))),
        changeRequests:
          value(get(changeRequests({ environmentId, input: { wikiId: wiki.wikiId } })))
            ?.changeRequests ?? null,
      }));
    }).pipe(Atom.withLabel(`environment-data:wiki:overview:${environmentId}`)),
  );

  return {
    /** Every change on an environment, for views that react to more than a refresh. */
    events,
    list,
    index,
    overview,
    note: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:wiki:note",
      tag: WS_METHODS.wikiReadNote,
      refreshTrigger: ({ environmentId, input }) => wikiChange(environmentId, input.wikiId),
    }),
    changeRequests,
    changeRequest: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:wiki:change-request",
      tag: WS_METHODS.wikiChangeRequestsGet,
      refreshTrigger: ({ environmentId, input }) => wikiChange(environmentId, input.wikiId),
    }),
    register: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:register",
      tag: WS_METHODS.wikiRegister,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:create",
      tag: WS_METHODS.wikiCreate,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:remove",
      tag: WS_METHODS.wikiRemove,
    }),
    openChangeRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:change-request:open",
      tag: WS_METHODS.wikiChangeRequestsOpen,
    }),
    amend: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:amend",
      tag: WS_METHODS.wikiAmend,
    }),
    transform: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:transform",
      tag: WS_METHODS.wikiTransform,
    }),
    revertAmendment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:revert-amendment",
      tag: WS_METHODS.wikiRevertAmendment,
    }),
    merge: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:merge",
      tag: WS_METHODS.wikiMerge,
    }),
    setChangeRequestStatus: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:change-request:set-status",
      tag: WS_METHODS.wikiSetChangeRequestStatus,
    }),
    setMirror: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:mirror:set",
      tag: WS_METHODS.wikiSetMirror,
    }),
    pushMirror: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:mirror:push",
      tag: WS_METHODS.wikiPushMirror,
    }),
  };
}
