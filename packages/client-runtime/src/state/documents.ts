import {
  DocumentError,
  EnvironmentAuthorizationError,
  WS_METHODS,
  type DocumentTarget,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AsyncResult, type Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribeDynamic } from "../rpc/client.ts";
import type { DocumentCallResult, DocumentChannel, DocumentFailure } from "./documentSession.ts";
import type { DocumentSession } from "./documentSession.ts";
import {
  createEnvironmentRpcCommand,
  followStreamInEnvironment,
  type AtomCommandResult,
} from "./runtime.ts";

const isDocumentError = Schema.is(DocumentError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

/** A failed document call or stream as the session reads it. */
function documentFailure(cause: Cause.Cause<unknown>): DocumentFailure {
  for (const reason of cause.reasons) {
    if (reason._tag !== "Fail") continue;
    const error = reason.error;
    if (isDocumentError(error)) return { reason: error.reason, message: error.message };
    if (isAuthorizationError(error)) return { reason: "other", message: error.message };
  }
  const hasFailure = cause.reasons.some((reason) => reason._tag === "Fail");
  // What is left is a connection that is gone or not there yet.
  return hasFailure
    ? { reason: "unavailable", message: "The environment is not connected." }
    : { reason: "other", message: Cause.pretty(cause) };
}

function callResult<A, E>(result: AtomCommandResult<A, E>): DocumentCallResult<A> {
  return AsyncResult.isSuccess(result)
    ? { ok: true, value: result.value }
    : { ok: false, error: documentFailure(result.cause) };
}

/**
 * Astrolabe: open repository files, with the environment as their authority. `follow` feeds a
 * `DocumentSession` the document's stream while it is mounted, resuming where the session left
 * off after a reconnect; `channel` gives it the permission-guarded calls.
 */
export function createDocumentEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const push = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:documents:push",
    tag: WS_METHODS.documentsPush,
  });
  const save = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:documents:save",
    tag: WS_METHODS.documentsSave,
  });
  const recover = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:documents:recover",
    tag: WS_METHODS.documentsRecover,
  });
  const discard = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:documents:discard",
    tag: WS_METHODS.documentsDiscard,
  });

  /** A fresh atom per session: mounting it opens the document, unmounting closes it. */
  const follow = (environmentId: EnvironmentId, session: DocumentSession) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        subscribeDynamic(WS_METHODS.documentsSubscribe, () =>
          Effect.sync(() => session.subscribeInput()),
        ),
      ).pipe(
        Stream.runForEach((item) => Effect.sync(() => session.receive(item))),
        Effect.catchCause((cause) => Effect.sync(() => session.failed(documentFailure(cause)))),
      ),
    );

  const channel = (
    registry: AtomRegistry.AtomRegistry,
    environmentId: EnvironmentId,
    target: DocumentTarget,
  ): DocumentChannel => ({
    push: (input) =>
      push.run(registry, { environmentId, input: { ...target, ...input } }).then(callResult),
    save: (input) =>
      save.run(registry, { environmentId, input: { ...target, ...input } }).then(callResult),
    recover: (input) =>
      recover.run(registry, { environmentId, input: { ...target, ...input } }).then(callResult),
    discard: (input) =>
      discard.run(registry, { environmentId, input: { ...target, ...input } }).then(callResult),
  });

  return { push, save, recover, discard, follow, channel };
}
