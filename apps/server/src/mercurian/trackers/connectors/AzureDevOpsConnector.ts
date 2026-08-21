/**
 * Azure DevOps Services' pull-only work-item connector.
 *
 * The service stores descriptions as HTML, so this adapter reduces them to
 * plain text at its boundary. Legacy visualstudio.com organizations redirect
 * to dev.azure.com; on-premises Azure DevOps Server waits for demand.
 *
 * @module AzureDevOpsConnector
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { TrimmedNonEmptyString } from "@t3tools/contracts";

import {
  trackerAuthRefusal,
  trackerUnreachableRefusal,
  type TrackerConnector,
  type TrackerConnectorRefusal,
} from "../connector.ts";

const AZURE_DEVOPS_ORIGIN = "https://dev.azure.com";
const ISSUE_PAGE_SIZE = 50;
const SEARCH_RESULT_WINDOW = 1_000;
const ISSUE_FIELDS = "System.Title,System.Description,System.State,System.TeamProject";
const ORGANIZATION_NAME_PATTERN = /^[a-z\d](?:[a-z\d-]{0,48}[a-z\d])?$/iu;

/** Every request this connector can send. The pull-only test reads this. */
export const AZURE_DEVOPS_REQUESTS = {
  projects: {
    name: "projects",
    method: "GET",
    pathPattern: "/_apis/projects",
    readOnly: true,
  },
  wiql: {
    name: "wiql",
    method: "POST",
    pathPattern: "/_apis/wit/wiql",
    readOnly: true,
  },
  workItemsBatch: {
    name: "workItemsBatch",
    method: "GET",
    pathPattern: "/_apis/wit/workitems",
    readOnly: true,
  },
  workItem: {
    name: "workItem",
    method: "GET",
    pathPattern: "/_apis/wit/workitems/{id}",
    readOnly: true,
  },
} as const;

type AzureDevOpsRequest = (typeof AZURE_DEVOPS_REQUESTS)[keyof typeof AZURE_DEVOPS_REQUESTS];

/** Bare names and dev.azure.com URLs both become the organization name. */
export function normalizeAzureDevOpsOrganization(input: string): string | null {
  const value = input.trim();
  if (ORGANIZATION_NAME_PATTERN.test(value)) return value;

  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== AZURE_DEVOPS_ORIGIN ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return null;
    }
    const match = /^\/([^/]+)\/?$/u.exec(parsed.pathname);
    const organization = match?.[1];
    return organization !== undefined && ORGANIZATION_NAME_PATTERN.test(organization)
      ? organization
      : null;
  } catch {
    return null;
  }
}

/** Escapes one value for a quoted WIQL string literal. */
export const escapeAzureDevOpsWiqlString = (value: string): string => value.replace(/'/gu, "''");

const buildWiql = (search?: string): string => {
  const trimmed = search?.trim();
  const where =
    trimmed === undefined || trimmed.length === 0
      ? ""
      : ` Where [System.Title] Contains '${escapeAzureDevOpsWiqlString(trimmed)}' Or [System.Description] Contains '${escapeAzureDevOpsWiqlString(trimmed)}'`;
  return `Select [System.Id] From WorkItems${where} Order By [System.ChangedDate] Desc`;
};

/** Reduces Azure's rich-text descriptions to the five-field shape's plain text. */
export function htmlToText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value
    .replace(/<\s*br\b[^>]*>/giu, "\n")
    .replace(/<\s*\/?\s*(?:p|div|li|h[1-6]|tr)\b[^>]*>/giu, "\n")
    .replace(/<[^>]*>/gu, "")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

const AzureDevOpsStoredCredential = Schema.Struct({
  organization: TrimmedNonEmptyString,
  token: TrimmedNonEmptyString,
});

const decodeStoredCredential = Schema.decodeUnknownEffect(
  Schema.fromJsonString(AzureDevOpsStoredCredential),
);

interface AzureDevOpsCredential {
  readonly organization: string;
  readonly token: string;
}

const unpackCredential = (
  credential: string,
): Effect.Effect<AzureDevOpsCredential, TrackerConnectorRefusal> =>
  decodeStoredCredential(credential).pipe(
    Effect.flatMap((decoded) => {
      const organization = normalizeAzureDevOpsOrganization(decoded.organization);
      return organization === null
        ? Effect.fail(trackerAuthRefusal)
        : Effect.succeed({ organization, token: decoded.token });
    }),
    Effect.mapError(() => trackerAuthRefusal),
  );

const AzureDevOpsWiqlResponse = Schema.Struct({
  workItems: Schema.Array(Schema.Struct({ id: Schema.Number })),
});

const AzureDevOpsWorkItemResponse = Schema.Struct({
  id: Schema.Number,
  fields: Schema.Struct({
    "System.Title": Schema.String,
    "System.Description": Schema.optional(Schema.NullOr(Schema.String)),
    "System.State": Schema.String,
    "System.TeamProject": Schema.String,
  }),
});

const AzureDevOpsWorkItemsResponse = Schema.Struct({
  value: Schema.Array(AzureDevOpsWorkItemResponse),
});

type AzureDevOpsWorkItemResponse = typeof AzureDevOpsWorkItemResponse.Type;

const mapIssue = (organization: string, issue: AzureDevOpsWorkItemResponse) => ({
  id: String(issue.id),
  title: issue.fields["System.Title"],
  description: htmlToText(issue.fields["System.Description"]),
  status: issue.fields["System.State"],
  url: `${AZURE_DEVOPS_ORIGIN}/${organization}/${encodeURIComponent(issue.fields["System.TeamProject"])}/_workitems/edit/${issue.id}`,
});

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

const isHtmlResponse = Effect.fn("AzureDevOpsConnector.isHtmlResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  if (/text\/html/iu.test(response.headers["content-type"] ?? "")) return true;
  const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
  return /<!doctype\s+html|<html\b/iu.test(body);
});

const parseOffset = (cursor?: string): number => {
  if (cursor === undefined || !/^\d+$/u.test(cursor)) return 0;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) ? offset : 0;
};

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const packCredential: TrackerConnector<"azure-devops">["packCredential"] = (input) =>
    JSON.stringify({
      organization: normalizeAzureDevOpsOrganization(input.organization) ?? input.organization,
      token: input.token,
    });

  /**
   * One Azure DevOps round trip. The PAT rides only in the Authorization
   * header with Azure's empty-username Basic convention.
   */
  const send = Effect.fn("AzureDevOpsConnector.send")(function* (
    credential: string,
    requestDefinition: AzureDevOpsRequest,
    options: {
      readonly path?: string;
      readonly urlParams?: Readonly<Record<string, string>>;
      readonly body?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    const decoded = yield* unpackCredential(credential);
    const url = new URL(
      `${AZURE_DEVOPS_ORIGIN}/${decoded.organization}${options.path ?? requestDefinition.pathPattern}`,
    );
    for (const [key, value] of Object.entries(options.urlParams ?? {})) {
      url.searchParams.set(key, value);
    }
    const baseRequest =
      requestDefinition.method === "GET"
        ? HttpClientRequest.get(url.toString())
        : HttpClientRequest.post(url.toString());
    const requestWithBody =
      options.body === undefined
        ? Effect.succeed(baseRequest)
        : baseRequest.pipe(HttpClientRequest.bodyJson(options.body));
    const request = (yield* requestWithBody.pipe(
      Effect.mapError(() => trackerUnreachableRefusal),
    )).pipe(HttpClientRequest.acceptJson, HttpClientRequest.basicAuth("", decoded.token));
    const response = yield* httpClient
      .execute(request)
      .pipe(Effect.mapError(() => trackerUnreachableRefusal));
    if (response.status === 401 || response.status === 403) {
      return yield* Effect.fail(trackerAuthRefusal);
    }
    return { response, organization: decoded.organization };
  });

  const decodeJson = <S extends Schema.Top>(
    response: HttpClientResponse.HttpClientResponse,
    schema: S,
  ): Effect.Effect<S["Type"], TrackerConnectorRefusal, S["DecodingServices"]> =>
    HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError(() => trackerUnreachableRefusal),
    );

  const requireSuccess = (
    response: HttpClientResponse.HttpClientResponse,
  ): Effect.Effect<void, TrackerConnectorRefusal> =>
    isSuccess(response.status) ? Effect.void : Effect.fail(trackerUnreachableRefusal);

  const probe: TrackerConnector<"azure-devops">["probe"] = Effect.fn("AzureDevOpsConnector.probe")(
    function* (credential: string) {
      const result = yield* send(credential, AZURE_DEVOPS_REQUESTS.projects, {
        urlParams: { "api-version": "7.1", $top: "1" },
      });
      if (result.response.status === 203 && (yield* isHtmlResponse(result.response))) {
        return yield* Effect.fail(trackerAuthRefusal);
      }
      yield* requireSuccess(result.response);
      return { label: result.organization };
    },
  );

  const listIssues: TrackerConnector<"azure-devops">["listIssues"] = Effect.fn(
    "AzureDevOpsConnector.listIssues",
  )(function* (credential: string, query) {
    const offset = parseOffset(query.cursor);
    const top = Math.min(offset + ISSUE_PAGE_SIZE + 1, SEARCH_RESULT_WINDOW);
    const wiqlResult = yield* send(credential, AZURE_DEVOPS_REQUESTS.wiql, {
      urlParams: { "api-version": "7.1", $top: String(top) },
      body: { query: buildWiql(query.search) },
    });
    yield* requireSuccess(wiqlResult.response);
    const wiql = yield* decodeJson(wiqlResult.response, AzureDevOpsWiqlResponse);
    const ids = wiql.workItems
      .map((workItem) => workItem.id)
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    const pageIds = ids.slice(offset, offset + ISSUE_PAGE_SIZE);
    if (pageIds.length === 0) return { issues: [] };

    const batchResult = yield* send(credential, AZURE_DEVOPS_REQUESTS.workItemsBatch, {
      urlParams: {
        ids: pageIds.join(","),
        fields: ISSUE_FIELDS,
        "api-version": "7.1",
      },
    });
    yield* requireSuccess(batchResult.response);
    const batch = yield* decodeJson(batchResult.response, AzureDevOpsWorkItemsResponse);
    const nextOffset = offset + ISSUE_PAGE_SIZE;
    return {
      issues: batch.value.map((issue) => mapIssue(batchResult.organization, issue)),
      ...(ids.length > nextOffset && nextOffset < SEARCH_RESULT_WINDOW
        ? { nextCursor: String(nextOffset) }
        : {}),
    };
  });

  const getIssue: TrackerConnector<"azure-devops">["getIssue"] = Effect.fn(
    "AzureDevOpsConnector.getIssue",
  )(function* (credential: string, issueId: string) {
    if (!/^[1-9]\d*$/u.test(issueId)) return null;
    const id = Number(issueId);
    if (!Number.isSafeInteger(id)) return null;
    const path = AZURE_DEVOPS_REQUESTS.workItem.pathPattern.replace("{id}", issueId);
    const result = yield* send(credential, AZURE_DEVOPS_REQUESTS.workItem, {
      path,
      urlParams: { fields: ISSUE_FIELDS, "api-version": "7.1" },
    });
    if (result.response.status === 404) return null;
    yield* requireSuccess(result.response);
    const issue = yield* decodeJson(result.response, AzureDevOpsWorkItemResponse);
    return mapIssue(result.organization, issue);
  });

  return {
    kind: "azure-devops",
    packCredential,
    probe,
    listIssues,
    getIssue,
  } satisfies TrackerConnector<"azure-devops">;
});
