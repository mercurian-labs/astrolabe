import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { TrackerConnectionId } from "@t3tools/contracts";

import {
  ServerSecretStore,
  SecretStorePersistError,
  type SecretStoreError,
} from "../../auth/ServerSecretStore.ts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import {
  trackerAuthRefusal,
  trackerUnreachableRefusal,
  type TrackerConnector,
  type TrackerConnectorRefusal,
} from "./connector.ts";
import * as TrackerConnectorRegistry from "./connectors/registry.ts";
import * as TrackerStore from "./TrackerStore.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);

/**
 * A connector under the test's control. `refusal` flips what the tracker says
 * next, which is how a key revoked in Linear is simulated without a network.
 */
interface StubConnector {
  readonly connector: TrackerConnector<"linear">;
  refusal: TrackerConnectorRefusal | null;
  readonly tokensSeen: Array<string>;
}

const makeStubConnector = (): StubConnector => {
  const state: StubConnector = {
    refusal: null,
    tokensSeen: [],
    connector: {
      kind: "linear",
      packCredential: (input) => input.token,
      probe: (token) => {
        state.tokensSeen.push(token);
        return state.refusal === null
          ? Effect.succeed({ label: "Mercurian" })
          : Effect.fail(state.refusal);
      },
      listIssues: (token) => {
        state.tokensSeen.push(token);
        return state.refusal === null
          ? Effect.succeed({
              issues: [
                {
                  id: "M-98",
                  title: "Tracker connections",
                  description: "Connect a tracker from Settings.",
                  url: "https://linear.app/mercurian/issue/M-98/tracker-connections",
                  status: "In Progress",
                },
              ],
            })
          : Effect.fail(state.refusal);
      },
      getIssue: (token, issueId) => {
        state.tokensSeen.push(token);
        return state.refusal === null
          ? Effect.succeed({
              id: issueId,
              title: "Tracker connections",
              description: "Connect a tracker from Settings.",
              url: `https://linear.app/mercurian/issue/${issueId}`,
              status: "In Progress",
            })
          : Effect.fail(state.refusal);
      },
    },
  };
  return state;
};

interface JiraStubConnector {
  readonly connector: TrackerConnector<"jira">;
  refusal: TrackerConnectorRefusal | null;
  readonly credentialsSeen: Array<string>;
}

const makeJiraStubConnector = (): JiraStubConnector => {
  const state: JiraStubConnector = {
    refusal: null,
    credentialsSeen: [],
    connector: {
      kind: "jira",
      packCredential: (input) => `packed:${input.site}|${input.email}|${input.token}`,
      probe: (credential) => {
        state.credentialsSeen.push(credential);
        return state.refusal === null
          ? Effect.succeed({ label: "Acme Jira" })
          : Effect.fail(state.refusal);
      },
      listIssues: (credential) => {
        state.credentialsSeen.push(credential);
        return state.refusal === null ? Effect.succeed({ issues: [] }) : Effect.fail(state.refusal);
      },
      getIssue: (credential) => {
        state.credentialsSeen.push(credential);
        return state.refusal === null ? Effect.succeed(null) : Effect.fail(state.refusal);
      },
    },
  };
  return state;
};

/** The secret store as a Map, so a test can look at exactly what was filed. */
interface StubSecrets {
  readonly files: Map<string, string>;
  failWrites: boolean;
  readonly layer: Layer.Layer<ServerSecretStore>;
}

const makeStubSecrets = (): StubSecrets => {
  const files = new Map<string, string>();
  const state = {
    files,
    failWrites: false,
    layer: Layer.succeed(
      ServerSecretStore,
      ServerSecretStore.of({
        get: (name) =>
          Effect.succeed(
            files.has(name)
              ? Option.some(new TextEncoder().encode(files.get(name)))
              : Option.none(),
          ),
        set: (name, value): Effect.Effect<void, SecretStoreError> =>
          state.failWrites
            ? Effect.fail(
                new SecretStorePersistError({
                  resource: `secret ${name}`,
                  cause: new Error("disk is full"),
                }),
              )
            : Effect.sync(() => {
                files.set(name, new TextDecoder().decode(value));
              }),
        create: (name, value) =>
          Effect.sync(() => {
            files.set(name, new TextDecoder().decode(value));
          }),
        getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
        // Not-found is success, exactly as the real store behaves.
        remove: (name) =>
          Effect.sync(() => {
            files.delete(name);
          }),
      }),
    ),
  };
  return state;
};

interface Harness {
  readonly connector: StubConnector;
  readonly jiraConnector: JiraStubConnector;
  readonly secrets: StubSecrets;
}

/**
 * A store over an in-memory Mercurian database, a stub secret store, and a stub
 * connector — with the standing cache's TTL zeroed so a flipped probe is
 * observable without a sleep.
 */
const withStore = <A, E>(
  body: (
    store: TrackerStore.TrackerStore["Service"],
    harness: Harness,
  ) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    // The suite shares one in-memory database, so each test starts from an
    // empty table and its row counts can be absolute.
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM tracker_connections`;

    const connector = makeStubConnector();
    const jiraConnector = makeJiraStubConnector();
    const secrets = makeStubSecrets();
    const store = yield* TrackerStore.make({ standingCacheTtl: Duration.zero }).pipe(
      Effect.provide(
        Layer.merge(
          TrackerConnectorRegistry.layerWith({
            linear: connector.connector,
            jira: jiraConnector.connector,
          }),
          secrets.layer,
        ),
      ),
    );
    return yield* body(store, { connector, jiraConnector, secrets });
  });

const layer = it.layer(Layer.provideMerge(MercurianSqlite.layerMemory, NodeServicesLayer));

const countConnections = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly count: number;
  }>`SELECT COUNT(*) AS count FROM tracker_connections`;
  return rows[0]?.count ?? 0;
});

layer("TrackerStore", (it) => {
  it.effect("connects a tracker, files its credential, and reports it connected", () =>
    withStore((store, { connector, secrets }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const status = yield* store.connect({
          kind: "linear",
          token: "lin_api_test",
          createdAt: at("2026-08-06T00:00:00.000Z"),
        });

        // The label is what the probe named, not anything the client sent.
        assert.strictEqual(status.connection.label, "Mercurian");
        assert.strictEqual(status.standing, "connected");

        // The credential is a file, keyed by connection, and it is the only
        // place the token exists.
        const secretName = `mercurian-tracker-${status.connection.connectionId}`;
        assert.strictEqual(secrets.files.get(secretName), "lin_api_test");
        assert.strictEqual(secrets.files.size, 1);
        assert.deepStrictEqual(connector.tokensSeen, ["lin_api_test"]);

        const snapshot = yield* store.getSnapshot;
        assert.deepStrictEqual(
          snapshot.connections.map((entry) => [entry.connection.connectionId, entry.standing]),
          [[status.connection.connectionId, "connected"]],
        );

        // Nothing that came back carries the token — there is no field for it
        // and no value equal to it.
        for (const entry of snapshot.connections) {
          assert.deepStrictEqual(Object.keys(entry.connection).toSorted(), [
            "connectionId",
            "createdAt",
            "kind",
            "label",
            "updatedAt",
          ]);
          for (const value of Object.values(entry.connection)) {
            assert.notStrictEqual(value, "lin_api_test");
          }
        }

        // Nor does the row: the table has no column it could live in.
        const rows = yield* sql<Record<string, unknown>>`SELECT * FROM tracker_connections`;
        for (const row of rows) {
          for (const value of Object.values(row)) {
            assert.notStrictEqual(value, "lin_api_test");
          }
        }
      }),
    ),
  );

  it.effect("packs Jira credentials once and uses the stored value for later calls", () =>
    withStore((store, { jiraConnector, secrets }) =>
      Effect.gen(function* () {
        const status = yield* store.connect({
          kind: "jira",
          site: "acme.atlassian.net",
          email: "dev@acme.com",
          token: "jira-secret",
          createdAt: at("2026-08-06T00:00:00.000Z"),
        });
        const packed = "packed:acme.atlassian.net|dev@acme.com|jira-secret";
        const secretName = `mercurian-tracker-${status.connection.connectionId}`;
        assert.strictEqual(secrets.files.get(secretName), packed);
        assert.deepStrictEqual(jiraConnector.credentialsSeen, [packed]);

        yield* store.listIssues({ connectionId: status.connection.connectionId });
        yield* store.getIssue({
          connectionId: status.connection.connectionId,
          issueId: "ACME-1",
        });
        assert.deepStrictEqual(jiraConnector.credentialsSeen, [packed, packed, packed]);
      }),
    ),
  );

  it.effect("creates nothing when Jira refuses its packed credential", () =>
    withStore((store, { jiraConnector, secrets }) =>
      Effect.gen(function* () {
        jiraConnector.refusal = trackerAuthRefusal;
        const refusal = yield* Effect.flip(
          store.connect({
            kind: "jira",
            site: "acme.atlassian.net",
            email: "dev@acme.com",
            token: "wrong",
            createdAt: at("2026-08-06T00:00:00.000Z"),
          }),
        );
        assert.strictEqual(refusal._tag, "TrackerAuthError");
        assert.strictEqual(secrets.files.size, 0);
        assert.strictEqual(yield* countConnections, 0);
      }),
    ),
  );

  it.effect("creates nothing when the tracker refuses the credential", () =>
    withStore((store, { connector, secrets }) =>
      Effect.gen(function* () {
        connector.refusal = trackerAuthRefusal;
        const refused = yield* Effect.flip(
          store.connect({
            kind: "linear",
            token: "wrong",
            createdAt: at("2026-08-06T00:00:00.000Z"),
          }),
        );
        assert.strictEqual(refused._tag, "TrackerAuthError");
        assert.strictEqual(secrets.files.size, 0);
        assert.strictEqual(yield* countConnections, 0);

        connector.refusal = trackerUnreachableRefusal;
        const unreachable = yield* Effect.flip(
          store.connect({
            kind: "linear",
            token: "any",
            createdAt: at("2026-08-06T00:00:00.000Z"),
          }),
        );
        assert.strictEqual(unreachable._tag, "TrackerUnreachableError");
        assert.strictEqual(secrets.files.size, 0);
        assert.strictEqual(yield* countConnections, 0);
      }),
    ),
  );

  it.effect("leaves no row behind when the credential cannot be filed", () =>
    withStore((store, { secrets }) =>
      Effect.gen(function* () {
        secrets.failWrites = true;
        yield* Effect.flip(
          store.connect({
            kind: "linear",
            token: "lin_api_test",
            createdAt: at("2026-08-06T00:00:00.000Z"),
          }),
        );
        assert.strictEqual(yield* countConnections, 0);
        assert.strictEqual(secrets.files.size, 0);
      }),
    ),
  );

  it.effect("leaves no credential behind when the row cannot be written", () =>
    withStore((store, { secrets }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Take the table away so the insert — and only the insert — fails.
        yield* sql`ALTER TABLE tracker_connections RENAME TO tracker_connections_hidden`;
        yield* Effect.flip(
          store.connect({
            kind: "linear",
            token: "lin_api_test",
            createdAt: at("2026-08-06T00:00:00.000Z"),
          }),
        );
        assert.strictEqual(secrets.files.size, 0);
        yield* sql`ALTER TABLE tracker_connections_hidden RENAME TO tracker_connections`;
      }),
    ),
  );

  it.effect("disconnects the row and the credential together, and only once", () =>
    withStore((store, { secrets }) =>
      Effect.gen(function* () {
        const status = yield* store.connect({
          kind: "linear",
          token: "lin_api_test",
          createdAt: at("2026-08-06T00:00:00.000Z"),
        });

        yield* store.disconnect({ connectionId: status.connection.connectionId });
        assert.strictEqual(yield* countConnections, 0);
        assert.strictEqual(secrets.files.size, 0);
        assert.deepStrictEqual((yield* store.getSnapshot).connections, []);

        const missing = yield* Effect.flip(
          store.disconnect({ connectionId: status.connection.connectionId }),
        );
        assert.strictEqual(missing._tag, "TrackerConnectionNotFoundError");
      }),
    ),
  );

  it.effect("decays to unauthorized when the tracker starts refusing the key", () =>
    withStore((store, { connector }) =>
      Effect.gen(function* () {
        yield* store.connect({
          kind: "linear",
          token: "lin_api_test",
          createdAt: at("2026-08-06T00:00:00.000Z"),
        });

        // The key is revoked in the tracker. Nothing in Mercurian changed, and
        // nothing had to be refreshed by hand.
        connector.refusal = trackerAuthRefusal;
        assert.strictEqual((yield* store.getSnapshot).connections[0]?.standing, "unauthorized");

        connector.refusal = trackerUnreachableRefusal;
        assert.strictEqual((yield* store.getSnapshot).connections[0]?.standing, "unreachable");

        connector.refusal = null;
        assert.strictEqual((yield* store.getSnapshot).connections[0]?.standing, "connected");
      }),
    ),
  );

  it.effect("reads issues live, in exactly the five-field shape", () =>
    withStore((store, { connector }) =>
      Effect.gen(function* () {
        const status = yield* store.connect({
          kind: "linear",
          token: "lin_api_test",
          createdAt: at("2026-08-06T00:00:00.000Z"),
        });

        const page = yield* store.listIssues({ connectionId: status.connection.connectionId });
        assert.deepStrictEqual(
          page.issues.map((issue) => Object.keys(issue).toSorted()),
          [["description", "id", "status", "title", "url"]],
        );
        assert.strictEqual(page.issues[0]?.id, "M-98");

        // The connector was handed the filed credential, not something else.
        assert.include(connector.tokensSeen, "lin_api_test");

        // Nothing was stored: the store keeps one table, and it holds
        // connections.
        const sql = yield* SqlClient.SqlClient;
        const tables = (yield* sql<{
          readonly name: string;
        }>`SELECT name FROM sqlite_master WHERE type = 'table'`).map((row) => row.name);
        assert.notInclude(tables.join(","), "issue");
      }),
    ),
  );

  it.effect("reads one origin directly for refresh", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const status = yield* store.connect({
          kind: "linear",
          token: "lin_api_test",
          createdAt: at("2026-08-06T00:00:00.000Z"),
        });
        const issue = yield* store.getIssue({
          connectionId: status.connection.connectionId,
          issueId: "M-109",
        });
        assert.strictEqual(issue?.id, "M-109");
      }),
    ),
  );

  it.effect("refuses a read against a connection that does not exist", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const refusal = yield* Effect.flip(
          store.listIssues({ connectionId: TrackerConnectionId.make("nope") }),
        );
        assert.strictEqual(refusal._tag, "TrackerConnectionNotFoundError");
      }),
    ),
  );

  it.effect("announces a change on connect and on disconnect", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 2)), {
          startImmediately: true,
        });

        const status = yield* store.connect({
          kind: "linear",
          token: "lin_api_test",
          createdAt: at("2026-08-06T00:00:00.000Z"),
        });
        yield* store.disconnect({ connectionId: status.connection.connectionId });

        assert.strictEqual((yield* Fiber.join(changes)).length, 2);
      }),
    ),
  );
});
