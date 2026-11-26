import {
  WS_METHODS,
  type EnvironmentId,
  type WikiChangeRequest,
  type WikiEvent,
  type ProjectRootId,
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
    const [environmentId, wikiId] = JSON.parse(key) as [EnvironmentId, ProjectRootId];
    return Atom.make((get): WikiEvent | null => {
      const event = get(latestChange(environmentId));
      if (event !== null && event.wikiId === wikiId) return event;
      return Option.getOrNull(get.self<WikiEvent | null>()) ?? null;
    }).pipe(Atom.withLabel(`environment-data:wiki:change:${key}`));
  });
  const wikiChange = (environmentId: EnvironmentId, wikiId: ProjectRootId) =>
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
    refreshTrigger: ({ environmentId, input }) => wikiChange(environmentId, input.wikiId),
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
    /** One view of a base, run on the server over the notes the read sees. */
    query: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:wiki:query",
      tag: WS_METHODS.wikiQuery,
      refreshTrigger: ({ environmentId, input }) => wikiChange(environmentId, input.wikiId),
    }),
    /** Files by path, any depth, at a commit; a board's canvas and the notes its cards show. */
    files: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:wiki:files",
      tag: WS_METHODS.wikiReadFiles,
      refreshTrigger: ({ environmentId, input }) => wikiChange(environmentId, input.wikiId),
    }),
    /** Every file in a wiki's repository, for a board's pickers. */
    fileList: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:wiki:file-list",
      tag: WS_METHODS.wikiListFiles,
      refreshTrigger: ({ environmentId, input }) => wikiChange(environmentId, input.wikiId),
    }),
    /** How code cards' files compare with their project's head. */
    codeStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:wiki:code-status",
      tag: WS_METHODS.wikiCodeStatus,
    }),
    changeRequests,
    changeRequest: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:wiki:change-request",
      tag: WS_METHODS.wikiChangeRequestsGet,
      refreshTrigger: ({ environmentId, input }) => wikiChange(environmentId, input.wikiId),
    }),
    transform: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:transform",
      tag: WS_METHODS.wikiTransform,
    }),
    autosave: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:autosave",
      tag: WS_METHODS.wikiAutosave,
    }),
    promoteDraft: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:draft:promote",
      tag: WS_METHODS.wikiDraftPromote,
    }),
    moveDraft: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:draft:move",
      tag: WS_METHODS.wikiDraftMove,
    }),
    move: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:move",
      tag: WS_METHODS.wikiMove,
    }),
    keepCanvas: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:keep-canvas",
      tag: WS_METHODS.wikiKeepCanvas,
    }),
    revertAmendment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:revert-amendment",
      tag: WS_METHODS.wikiRevertAmendment,
    }),
    setChangeRequestStatus: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:change-request:set-status",
      tag: WS_METHODS.wikiSetChangeRequestStatus,
    }),
    publishChangeRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:change-request:publish",
      tag: WS_METHODS.wikiPublishChangeRequest,
    }),
    resolveConflicts: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:wiki:change-request:resolve-conflicts",
      tag: WS_METHODS.wikiResolveConflicts,
    }),
  };
}
