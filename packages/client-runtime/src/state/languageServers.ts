import {
  WS_METHODS,
  type EnvironmentId,
  type LanguageServerProblemsItem,
  type LanguageServerSendInput,
  type LanguageServerSessionItem,
  type LanguageServerTarget,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribeDynamic } from "../rpc/client.ts";
import { createEnvironmentRpcCommand, followStreamInEnvironment } from "./runtime.ts";

/**
 * Astrolabe: language servers in an environment. An editor opens its own LSP session to the
 * gateway: `session` streams the server's status and messages while it is mounted, and `send`
 * carries the editor's messages, in order. Restarting, stopping and the download consent are
 * permission-guarded.
 */
export function createLanguageServerEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const send = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:language-servers:send",
    tag: WS_METHODS.languageServersSend,
    // LSP is ordered: an open must reach the gateway before the requests about that file.
    concurrency: { mode: "serial", key: ({ input }) => input.sessionId },
  });
  const restart = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:language-servers:restart",
    tag: WS_METHODS.languageServersRestart,
  });
  const stop = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:language-servers:stop",
    tag: WS_METHODS.languageServersStop,
  });
  const confirmDownload = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:language-servers:confirm-download",
    tag: WS_METHODS.languageServersConfirmDownload,
  });

  /**
   * A fresh atom per editor. Each subscription, a reconnect's included, is a new session with an
   * id from `openSession`: the gateway forgets a session whose stream ended.
   */
  const session = (
    environmentId: EnvironmentId,
    target: LanguageServerTarget,
    handlers: {
      readonly openSession: () => string;
      readonly onItem: (item: LanguageServerSessionItem) => void;
    },
  ) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        subscribeDynamic(WS_METHODS.languageServersSession, () =>
          Effect.sync(() => ({ ...target, sessionId: handlers.openSession() })),
        ),
      ).pipe(
        Stream.runForEach((item) => Effect.sync(() => handlers.onItem(item))),
        Effect.ignore,
      ),
    );

  /** A checkout's problems while mounted: each item as it arrives, again after a reconnect. */
  const problems = (
    environmentId: EnvironmentId,
    cwd: string,
    onItem: (item: LanguageServerProblemsItem) => void,
  ) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        subscribeDynamic(WS_METHODS.languageServersProblems, () => Effect.succeed({ cwd })),
      ).pipe(
        Stream.runForEach((item) => Effect.sync(() => onItem(item))),
        Effect.ignore,
      ),
    );

  /** An editor's messages to its session, sent in order. */
  const sender =
    (registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) =>
    (input: LanguageServerSendInput) => {
      void send.run(registry, { environmentId, input });
    };

  return { send, sender, restart, stop, confirmDownload, session, problems };
}
