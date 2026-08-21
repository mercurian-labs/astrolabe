/**
 * Every connector Mercurian ships, keyed by kind.
 *
 * Total over `TrackerKind` by type, so adding a literal without adding its
 * connector is a compile error rather than a runtime hole — and adding a
 * tracker is exactly this file plus one connector module.
 *
 * @module TrackerConnectorRegistry
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TrackerConnectorRegistry } from "../connector.ts";
import * as GitHubConnector from "./GitHubConnector.ts";
import * as GitLabConnector from "./GitLabConnector.ts";
import * as JiraConnector from "./JiraConnector.ts";
import * as LinearConnector from "./LinearConnector.ts";

export class TrackerConnectors extends Context.Service<
  TrackerConnectors,
  TrackerConnectorRegistry
>()("t3/mercurian/trackers/connectors/registry/TrackerConnectors") {}

export const make = Effect.gen(function* () {
  const linear = yield* LinearConnector.make;
  const jira = yield* JiraConnector.make;
  const github = yield* GitHubConnector.make;
  const gitlab = yield* GitLabConnector.make;
  return TrackerConnectors.of({ linear, jira, github, gitlab });
});

export const layer = Layer.effect(TrackerConnectors, make);

/** A registry of stubs, for tests that care about the store rather than HTTP. */
export const layerWith = (connectors: TrackerConnectorRegistry) =>
  Layer.succeed(TrackerConnectors, TrackerConnectors.of(connectors));
