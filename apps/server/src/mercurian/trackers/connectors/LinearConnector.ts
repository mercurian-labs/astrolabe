/**
 * Linear, the first tracker Mercurian connects to.
 *
 * Chosen first because the team's own backlog lives there — so the feature is
 * dogfoodable the day it lands — and because its auth is the cheapest of the
 * family: one personal API key in one header, no app registration, and a single
 * GraphQL endpoint. Jira's site-URL-plus-email-plus-token triple and GitHub's
 * app/PAT scoping are exactly the per-kind variance worth deferring until the
 * seam has proven itself on the simple case.
 *
 * **Pull-only, structurally.** Every GraphQL document this module sends is
 * exported as a named constant and is a `query`; a unit test parses each one
 * and fails the suite if an operation is anything else. Together with a
 * connector interface that has no write method and a wire surface with no
 * tracker-ward call, "no operation anywhere writes to the tracker" holds at
 * three independent layers rather than by anyone's discipline.
 *
 * @module LinearConnector
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import {
  trackerAuthRefusal,
  trackerUnreachableRefusal,
  type TrackerConnector,
  type TrackerConnectorRefusal,
} from "../connector.ts";

type Connector = TrackerConnector<"linear">;

export const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

/** How many issues one browse page asks for. */
const ISSUE_PAGE_SIZE = 50;

/**
 * Names the workspace a key reaches, and — by succeeding at all — says the key
 * is live. This is both the connect-time validation and the standing probe.
 */
export const LINEAR_PROBE_DOCUMENT = `
  query MercurianTrackerProbe {
    viewer { id }
    organization { name urlKey }
  }
`;

/**
 * The browse. The selection set *is* the minimal common shape: five fields and
 * a cursor, and there is nowhere for a label, an assignee, or an estimate to
 * arrive even if someone wanted one.
 */
export const LINEAR_ISSUES_DOCUMENT = `
  query MercurianTrackerIssues($first: Int!, $after: String, $filter: IssueFilter) {
    issues(first: $first, after: $after, filter: $filter) {
      nodes {
        identifier
        title
        description
        url
        state { name }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const LINEAR_ISSUE_DOCUMENT = `
  query MercurianTrackerIssue($id: String!) {
    issue(id: $id) {
      identifier
      title
      description
      url
      state { name }
    }
  }
`;

/** Every document this connector can send. The pull-only test reads this. */
export const LINEAR_GRAPHQL_DOCUMENTS = [
  LINEAR_PROBE_DOCUMENT,
  LINEAR_ISSUES_DOCUMENT,
  LINEAR_ISSUE_DOCUMENT,
] as const;

/**
 * The operation types a GraphQL document declares, in source order.
 *
 * A deliberately small reader rather than a parser dependency: it only has to
 * answer "is anything in here not a query?", and an anonymous document (`{ … }`)
 * is a query by GraphQL's own shorthand rule.
 */
export function graphqlOperationTypes(document: string): ReadonlyArray<string> {
  const withoutComments = document.replace(/#[^\n]*/g, "");
  const operations = withoutComments.matchAll(/(^|[\s})])(query|mutation|subscription)\b/g);
  const types = [...operations].map(([, , operationType]) => operationType ?? "");
  return types.length === 0 && withoutComments.trim().startsWith("{") ? ["query"] : types;
}

const LinearGraphQLError = Schema.Struct({
  message: Schema.optional(Schema.String),
  extensions: Schema.optional(
    Schema.Struct({
      code: Schema.optional(Schema.String),
      type: Schema.optional(Schema.String),
    }),
  ),
});

const LinearProbeResponse = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        organization: Schema.NullOr(Schema.Struct({ name: Schema.String })),
      }),
    ),
  ),
  errors: Schema.optional(Schema.NullOr(Schema.Array(LinearGraphQLError))),
});

const LinearIssuesResponse = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        issues: Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({
              identifier: Schema.String,
              title: Schema.optional(Schema.NullOr(Schema.String)),
              description: Schema.optional(Schema.NullOr(Schema.String)),
              url: Schema.String,
              state: Schema.optional(
                Schema.NullOr(
                  Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) }),
                ),
              ),
            }),
          ),
          pageInfo: Schema.Struct({
            hasNextPage: Schema.Boolean,
            endCursor: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        }),
      }),
    ),
  ),
  errors: Schema.optional(Schema.NullOr(Schema.Array(LinearGraphQLError))),
});

const LinearIssue = Schema.Struct({
  identifier: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  state: Schema.optional(
    Schema.NullOr(Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
});

const LinearIssueResponse = Schema.Struct({
  data: Schema.optional(Schema.NullOr(Schema.Struct({ issue: Schema.NullOr(LinearIssue) }))),
  errors: Schema.optional(Schema.NullOr(Schema.Array(LinearGraphQLError))),
});

type LinearGraphQLError = typeof LinearGraphQLError.Type;

const AUTH_ERROR_PATTERN = /authentic|unauthor|invalid.?(api.?key|token)|forbidden/i;

/**
 * A GraphQL body can carry a rejected credential under an HTTP 200, so the
 * `errors` array has to be read as carefully as the status line.
 */
function isAuthError(errors: ReadonlyArray<LinearGraphQLError>): boolean {
  return errors.some((error) => {
    const code = error.extensions?.code ?? "";
    const type = error.extensions?.type ?? "";
    return (
      AUTH_ERROR_PATTERN.test(code) ||
      AUTH_ERROR_PATTERN.test(type) ||
      AUTH_ERROR_PATTERN.test(error.message ?? "")
    );
  });
}

/**
 * The tracker said no. 401/403 is the credential; 400 is Linear's own shape for
 * a rejected key, so its body decides; anything else is the service, not the
 * person, and reads as unreachable.
 */
const refusalForStatus = (status: number): TrackerConnectorRefusal =>
  status === 401 || status === 403 ? trackerAuthRefusal : trackerUnreachableRefusal;

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const packCredential: Connector["packCredential"] = (input) => input.token;

  /**
   * One GraphQL round trip. The key rides in the `Authorization` header and
   * nowhere else — it is never logged, never attached to a span, and never part
   * of a failure's payload, which is why both refusals are payload-free values.
   */
  const send = <S extends Schema.Top>(
    token: string,
    schema: S,
    body: { readonly query: string; readonly variables?: Record<string, unknown> },
  ): Effect.Effect<S["Type"], TrackerConnectorRefusal, S["DecodingServices"]> =>
    HttpClientRequest.post(LINEAR_GRAPHQL_ENDPOINT).pipe(
      HttpClientRequest.setHeader("Authorization", token),
      HttpClientRequest.bodyJson(body),
      Effect.flatMap(httpClient.execute),
      // A transport failure, a body that will not decode, or a status Linear
      // never documents are all "we could not get an answer".
      Effect.mapError(() => trackerUnreachableRefusal),
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? HttpClientResponse.schemaBodyJson(schema)(response).pipe(
              Effect.mapError(() => trackerUnreachableRefusal),
            )
          : // Read the body of a 4xx too: Linear answers a bad key with a 400
            // whose payload is the only thing that says so.
            HttpClientResponse.schemaBodyJson(schema)(response).pipe(
              Effect.match({
                onFailure: () => refusalForStatus(response.status),
                onSuccess: (decoded: S["Type"]) => {
                  const errors = (
                    decoded as { readonly errors?: ReadonlyArray<LinearGraphQLError> | null }
                  ).errors;
                  return errors && isAuthError(errors)
                    ? trackerAuthRefusal
                    : refusalForStatus(response.status);
                },
              }),
              Effect.flatMap(Effect.fail),
            ),
      ),
    );

  const probe: Connector["probe"] = Effect.fn("LinearConnector.probe")(function* (token: string) {
    const response = yield* send(token, LinearProbeResponse, { query: LINEAR_PROBE_DOCUMENT });
    if (response.errors && response.errors.length > 0) {
      return yield* Effect.fail(
        isAuthError(response.errors) ? trackerAuthRefusal : trackerUnreachableRefusal,
      );
    }
    const name = response.data?.organization?.name?.trim();
    // A key that reaches an unnamed workspace is still a working key; the
    // tracker's own name is the honest fallback for the connection's label.
    return { label: name === undefined || name.length === 0 ? "Linear" : name };
  });

  const listIssues: Connector["listIssues"] = Effect.fn("LinearConnector.listIssues")(function* (
    token: string,
    query,
  ) {
    const search = query.search?.trim();
    const response = yield* send(token, LinearIssuesResponse, {
      query: LINEAR_ISSUES_DOCUMENT,
      variables: {
        first: ISSUE_PAGE_SIZE,
        after: query.cursor ?? null,
        // Searching is the tracker's job: it is the only thing that knows its
        // own backlog. Absent search means the whole backlog, newest first.
        filter:
          search === undefined || search.length === 0
            ? null
            : {
                or: [
                  { title: { containsIgnoreCase: search } },
                  { description: { containsIgnoreCase: search } },
                ],
              },
      },
    });
    if (response.errors && response.errors.length > 0) {
      return yield* Effect.fail(
        isAuthError(response.errors) ? trackerAuthRefusal : trackerUnreachableRefusal,
      );
    }

    const page = response.data?.issues;
    const nextCursor =
      page?.pageInfo.hasNextPage === true ? (page.pageInfo.endCursor ?? null) : null;
    return {
      // The mapping *is* the narrow shape: `identifier` is the human-facing
      // key a person would say out loud ("M-98"), an absent description is an
      // empty one, `state.name` is the tracker's own status word left
      // uninterpreted, and `url` is Linear's canonical link — the origin link
      // straight from the source of truth.
      issues: (page?.nodes ?? []).map((node) => ({
        id: node.identifier.trim(),
        title: node.title ?? "",
        description: node.description ?? "",
        url: node.url.trim(),
        status: node.state?.name ?? "",
      })),
      ...(nextCursor === null || nextCursor.trim().length === 0
        ? {}
        : { nextCursor: nextCursor.trim() }),
    };
  });

  const getIssue: Connector["getIssue"] = Effect.fn("LinearConnector.getIssue")(function* (
    token: string,
    issueId: string,
  ) {
    const response = yield* send(token, LinearIssueResponse, {
      query: LINEAR_ISSUE_DOCUMENT,
      variables: { id: issueId },
    });
    if (response.errors && response.errors.length > 0) {
      return yield* Effect.fail(
        isAuthError(response.errors) ? trackerAuthRefusal : trackerUnreachableRefusal,
      );
    }
    const issue = response.data?.issue;
    return issue === null || issue === undefined
      ? null
      : {
          id: issue.identifier.trim(),
          title: issue.title ?? "",
          description: issue.description ?? "",
          url: issue.url.trim(),
          status: issue.state?.name ?? "",
        };
  });

  return {
    kind: "linear",
    packCredential,
    probe,
    listIssues,
    getIssue,
  } satisfies Connector;
});
